#!/usr/bin/env pwsh

<#
.SYNOPSIS
Finds the Transactor QuoteXml and QuoteResponse log files for a policy and history, and offers to copy them locally.

.DESCRIPTION
Log files are named <timestamp>_<post-code>_<policy-details-id>_<history-id>_<kind>.xml, e.g.
2026101490838_SY22 6XZ_98B7F028F9C41780927C4F8B096782E7_1_QuoteXml.xml

Each time a quote is quoted gives a match: a QuoteXml and a QuoteResponse file that share the same name apart from
<kind>. The matches are listed newest first, and you choose to copy the latest, the most recent N, or all of them.

.PARAMETER PolicyDetailsId
The policy details ID, as a GUID with the '-' removed.

.PARAMETER HistoryId
The history ID, a non-negative whole number.

.PARAMETER Environment
The environment whose Transactor server to search: dev (devtqs01) or tst (tsttqs01). Defaults to dev.

.PARAMETER MaxAgeInDays
Only find files written in the last this many days. Defaults to 1.

.PARAMETER LogFolder
The log folder to search. Defaults to the Transactor XML log share on the -Environment's server.

.PARAMETER Destination
Where to copy the files. Defaults to the current folder, and is created if it doesn't exist.

.PARAMETER Recurse
Also search the log folder's archive subfolders, which is noticeably slower.

.PARAMETER NoFormat
Copy the files as they are. Without it, the copies are formatted so they diff cleanly: with Prettier when it can
format XML (i.e. @prettier/plugin-xml is set up), otherwise with .NET's XmlWriter using a 2-space indent and LF line
endings.

.EXAMPLE
./scripts/Get-TransactorQuoteXml.ps1 98B7F028F9C41780927C4F8B096782E7 1

.EXAMPLE
./scripts/Get-TransactorQuoteXml.ps1 98B7F028F9C41780927C4F8B096782E7 1 -Environment tst

.EXAMPLE
./scripts/Get-TransactorQuoteXml.ps1 98B7F028F9C41780927C4F8B096782E7 1 -MaxAgeInDays 5

.EXAMPLE
./scripts/Get-TransactorQuoteXml.ps1 98B7F028F9C41780927C4F8B096782E7 1 -NoFormat
#>
param(
    [Parameter(Mandatory)]
    [string]$PolicyDetailsId,

    [Parameter(Mandatory)]
    [string]$HistoryId,

    [ValidateSet("dev", "tst")]
    [string]$Environment = "dev",

    [ValidateRange(1, [int]::MaxValue)]
    [int]$MaxAgeInDays = 1,

    [string]$LogFolder = "\\$($Environment)tqs01\c$\Logs\Transactor_Xml_Log",

    [string]$Destination = "$((Get-Location).Path)\output",

    [switch]$Recurse,

    [switch]$NoFormat
)

function Format-XmlFiles([string[]]$Paths) {
    if (Test-PrettierFormatsXml $Paths[0]) {
        Push-Location $PSScriptRoot
        try {
            npx --no-install prettier --write --log-level warn $Paths
        }
        finally {
            Pop-Location
        }

        if ($LASTEXITCODE -eq 0) {
            Write-Host "Formatted $($Paths.Count) file(s) with Prettier" -ForegroundColor Green
            return
        }

        Write-Host "Prettier failed, formatting with .NET XmlWriter instead" -ForegroundColor Yellow
    }

    $formattedCount = 0
    foreach ($path in $Paths) {
        try {
            Format-XmlFileWithXmlWriter $path
            $formattedCount++
        }
        catch {
            Write-Host "Left '$path' unformatted: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    Write-Host "Formatted $formattedCount of $($Paths.Count) file(s) with .NET XmlWriter" -ForegroundColor Green
}

function Test-PrettierFormatsXml([string]$Path) {
    # Prettier has no XML parser of its own, so it only formats XML when a plugin such as @prettier/plugin-xml is set up
    Push-Location $PSScriptRoot
    try {
        $fileInfo = npx --no-install prettier --file-info $Path 2>$null
    }
    finally {
        Pop-Location
    }

    if ($LASTEXITCODE -ne 0) {
        return $false
    }

    return $null -ne ($fileInfo | Out-String | ConvertFrom-Json).inferredParser
}

function Format-XmlFileWithXmlWriter([string]$Path) {
    $document = [System.Xml.XmlDocument]::new()
    $document.Load($Path)

    # Keep the file's declared encoding, so the declaration still describes the bytes that follow it
    # (UTF-8 without a BOM, as GetEncoding's UTF-8 would add one)
    $declaration = $document.FirstChild -as [System.Xml.XmlDeclaration]
    $encoding = [System.Text.UTF8Encoding]::new($false)
    if ($declaration -and $declaration.Encoding) {
        $declaredEncoding = [System.Text.Encoding]::GetEncoding($declaration.Encoding)
        if ($declaredEncoding.CodePage -ne $encoding.CodePage) {
            $encoding = $declaredEncoding
        }
    }

    $settings = [System.Xml.XmlWriterSettings]@{
        Indent       = $true
        IndentChars  = "  "
        NewLineChars = "`n"
        Encoding     = $encoding
    }

    $writer = [System.Xml.XmlWriter]::Create($Path, $settings)
    try {
        $document.Save($writer)
    }
    finally {
        $writer.Dispose()
    }
}

if ($PolicyDetailsId -notmatch "^[0-9A-Fa-f]{32}$") {
    Write-Host "PolicyDetailsId must be a GUID with the '-' removed (32 hex characters), got '$PolicyDetailsId'" -ForegroundColor Red
    exit 1
}

$historyIdValue = 0
if (![int]::TryParse($HistoryId, [ref]$historyIdValue) -or $historyIdValue -lt 0) {
    Write-Host "HistoryId must be a non-negative whole number, got '$HistoryId'" -ForegroundColor Red
    exit 1
}

if (!(Test-Path -LiteralPath $LogFolder -PathType Container)) {
    Write-Host "Can't reach the log folder '$LogFolder'" -ForegroundColor Red
    exit 1
}

# The filter is applied by the file system, so only the matching names come back over the network
$filter = "*_$($PolicyDetailsId.ToUpperInvariant())_$($historyIdValue)_Quote*.xml"
$since = (Get-Date).AddDays(-$MaxAgeInDays)
Write-Host "Searching $LogFolder for $filter written since $($since.ToString("yyyy-MM-dd HH:mm:ss"))" -ForegroundColor Green
$files = @(Get-ChildItem -LiteralPath $LogFolder -Filter $filter -File -Recurse:$Recurse |
        Where-Object { $_.Name -match "_(QuoteXml|QuoteResponse)\.xml$" -and $_.LastWriteTime -ge $since })

if ($files.Count -eq 0) {
    Write-Host "No QuoteXml or QuoteResponse files found in the last $MaxAgeInDays day(s)" -ForegroundColor Yellow
    Get-Help $PSCommandPath -Detailed
    exit 0
}

# A QuoteXml and its QuoteResponse share the same path apart from the kind, so that path identifies the match
$matchGroups = @($files |
        Group-Object { $_.FullName -replace "_(QuoteXml|QuoteResponse)\.xml$", "" } |
        Sort-Object { ($_.Group | Measure-Object LastWriteTime -Maximum).Maximum } -Descending)

Write-Host "Found $($matchGroups.Count) match(es), newest first:" -ForegroundColor Green
for ($i = 0; $i -lt $matchGroups.Count; $i++) {
    $newest = ($matchGroups[$i].Group | Measure-Object LastWriteTime -Maximum).Maximum
    Write-Host "$($i + 1). $($newest.ToString("yyyy-MM-dd HH:mm:ss"))" -ForegroundColor Cyan
    foreach ($file in $matchGroups[$i].Group | Sort-Object Name -Descending) {
        Write-Host "   $([System.IO.Path]::GetRelativePath($LogFolder, $file.FullName))"
    }
}

$answer = Read-Host "Copy to '$Destination'? [L]atest, a number of the most recent matches, [A]ll, or Enter for none"
$copyCount = 0
if ($answer -match "^(l|latest)$") {
    $copyCount = 1
}
elseif ($answer -match "^(a|all)$") {
    $copyCount = $matchGroups.Count
}
elseif (![int]::TryParse($answer, [ref]$copyCount) -or $copyCount -lt 0) {
    $copyCount = 0
}

if ($copyCount -eq 0) {
    Write-Host "Not copied"
    exit 0
}

$copyCount = [Math]::Min($copyCount, $matchGroups.Count)
$filesToCopy = @($matchGroups | Select-Object -First $copyCount | ForEach-Object { $_.Group })
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$copiedPaths = @(foreach ($file in $filesToCopy) {
        (Copy-Item -LiteralPath $file.FullName -Destination $Destination -PassThru).FullName
    })
Write-Host "Copied $copyCount match(es), $($filesToCopy.Count) file(s), to '$Destination'" -ForegroundColor Green

if (!$NoFormat) {
    Format-XmlFiles $copiedPaths
}
