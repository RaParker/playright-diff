#!/usr/bin/env pwsh

<#
.SYNOPSIS
Zips a policy's output folder (<policy-details-id>-<history-id>) from the output folder set in .env.

.DESCRIPTION
The output folder is OUTPUT_DIR, taken from this project's .env when it is set there, otherwise from the environment,
otherwise the current directory - the same order the npm commands use (.env comes first for OUTPUT_DIR only, so a value
left in the shell for mrp-and-quote, which reads its own OUTPUT_DIR, is ignored) - followed by the
QUOTE_JOURNEY_ENVIRONMENT subfolder (from the environment, otherwise .env, e.g. dev) when one is set. The output folder
and the zip folder must be outside this project. The policy's folder in it is zipped to
<policy-details-id>-<history-id>.zip, so the zip extracts to a folder of the same name.

When the zip already exists you are asked whether to replace it, unless -Force is given.

.PARAMETER PolicyDetailsId
The policy details ID, as a GUID with the '-' removed.

.PARAMETER HistoryId
The history ID, a non-negative whole number. Defaults to 1.

.PARAMETER Destination
The folder to write the zip to. Defaults to the output folder, and is created if it doesn't exist.

.PARAMETER RunName
A named run to zip from: its folder OUTPUT_DIR/<RunName> is used instead of the environment's subfolder. Without it,
QUOTE_JOURNEY_RUN_NAME is used when set (from the environment, otherwise .env). The name must be a valid folder name on
both Windows and Linux, and not an environment name, as the npm commands require.

.PARAMETER Force
Replace an existing zip without asking.

.PARAMETER EnvFile
The .env file to read OUTPUT_DIR and QUOTE_JOURNEY_ENVIRONMENT from. Defaults to this project's .env.

.PARAMETER Help
Show this help.

.EXAMPLE
./Create-ZipFromOutput.ps1 106D1920D02642E2A0F55131BB75ED7D

Zips <output folder>/106D1920D02642E2A0F55131BB75ED7D-1 to <output folder>/106D1920D02642E2A0F55131BB75ED7D-1.zip.

.EXAMPLE
./Create-ZipFromOutput.ps1 106D1920D02642E2A0F55131BB75ED7D 2 -Force

Zips history 2, replacing any existing zip without asking.
#>
[CmdletBinding(DefaultParameterSetName = "Zip")]
param(
    [Parameter(Mandatory, Position = 0, ParameterSetName = "Zip")]
    [string]$PolicyDetailsId,

    [Parameter(Position = 1, ParameterSetName = "Zip")]
    [string]$HistoryId = "1",

    [Parameter(Position = 2, ParameterSetName = "Zip")]
    [string]$Destination,

    [Parameter(ParameterSetName = "Zip")]
    [string]$RunName,

    [Parameter(ParameterSetName = "Zip")]
    [switch]$Force,

    [Parameter(ParameterSetName = "Zip")]
    [string]$EnvFile = (Join-Path $PSScriptRoot ".env"),

    [Parameter(Mandatory, ParameterSetName = "Help")]
    [switch]$Help
)

#Requires -Version 7.4
Set-StrictMode -Version Latest                   # error on undefined variables, missing properties, bad indexing
$ErrorActionPreference = 'Stop'                  # non-terminating errors become terminating
$PSNativeCommandUseErrorActionPreference = $true # non-zero exit codes from native commands (git, kubectl, go…) throw

. (Join-Path $PSScriptRoot "scripts" "Get-EnvFileValue.ps1")
. (Join-Path $PSScriptRoot "scripts" "Get-RunNameProblem.ps1")

function Get-OutputFolder([string]$Path) {
    $baseFolder = Get-Setting $Path "OUTPUT_DIR"
    if (!$baseFolder) {
        $baseFolder = (Get-Location).Path
    }

    # A named run keeps its output in OUTPUT_DIR/<run name>, as the npm commands write it
    $name = if ($RunName) {
        $RunName
    }
    else {
        Get-Setting $Path "QUOTE_JOURNEY_RUN_NAME"
    }

    if ($name) {
        $problem = Get-RunNameProblem $name
        if ($problem) {
            throw "Run name `"$name`" $problem."
        }

        return Join-Path $baseFolder $name
    }

    # Otherwise output is kept per environment (OUTPUT_DIR/<environment>), as the npm commands write it
    $environment = Get-Setting $Path "QUOTE_JOURNEY_ENVIRONMENT"
    if (!$environment) {
        return $baseFolder
    }

    return Join-Path $baseFolder $environment.Trim().ToLowerInvariant()
}

# Whether the path is this project or inside it, ignoring case as Windows does; output is never written there
function Test-InsideProject([string]$Path) {
    $separators = [char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $project = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd($separators)
    $fullPath = [System.IO.Path]::GetFullPath($Path, (Get-Location).Path).TrimEnd($separators)
    return $fullPath -ieq $project -or
    $fullPath.StartsWith("$project$([System.IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase)
}

# Returns the setting from the environment when it is set there, otherwise from the .env file. OUTPUT_DIR is the
# exception: .env comes first, as in src/environment.ts, because mrp-and-quote reads an OUTPUT_DIR of its own
function Get-Setting([string]$Path, [string]$Name) {
    if ($Name -eq "OUTPUT_DIR") {
        $fromFile = Get-EnvFileValue $Path $Name
        if ($fromFile) {
            return $fromFile
        }
    }

    $fromEnvironment = [Environment]::GetEnvironmentVariable($Name)
    if ($fromEnvironment) {
        return $fromEnvironment
    }

    return Get-EnvFileValue $Path $Name
}

if ($Help) {
    . (Join-Path $PSScriptRoot "scripts" "Get-ScriptHelpText.ps1")
    Write-Host (Get-ScriptHelpText $PSCommandPath)
    exit 0
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

# As in the npm commands: without OUTPUT_DIR in .env, an OUTPUT_DIR left in the shell for mrp-and-quote would be used
if ([Environment]::GetEnvironmentVariable('DIFF_OUTPUT_DIR') -or (Get-EnvFileValue $EnvFile 'DIFF_OUTPUT_DIR')) {
    Write-Host 'DIFF_OUTPUT_DIR was renamed OUTPUT_DIR: rename it in .env (and unset any DIFF_OUTPUT_DIR in the shell).' -ForegroundColor Red
    exit 1
}

try {
    $outputFolder = Get-OutputFolder $EnvFile
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

if (Test-InsideProject $outputFolder) {
    Write-Host "The output folder '$outputFolder' is inside this project ($PSScriptRoot). Set OUTPUT_DIR in .env to a folder outside it." -ForegroundColor Red
    exit 1
}

$policyFolderName = "$($PolicyDetailsId.ToUpperInvariant())-$historyIdValue"
$policyFolder = Join-Path $outputFolder $policyFolderName
if (!(Test-Path -LiteralPath $policyFolder -PathType Container)) {
    Write-Host "No output folder '$policyFolder'" -ForegroundColor Red
    exit 1
}

if (!$Destination) {
    $Destination = $outputFolder
}

if (Test-InsideProject $Destination) {
    Write-Host "The zip folder '$Destination' is inside this project ($PSScriptRoot). Choose a folder outside it, so runs leave the project unchanged." -ForegroundColor Red
    exit 1
}

$zipPath = Join-Path $Destination "$policyFolderName.zip"
if ((Test-Path -LiteralPath $zipPath) -and !$Force) {
    $answer = Read-Host "'$zipPath' already exists. Replace it? [y/N]"
    if ($answer -notmatch "^(y|yes)$") {
        Write-Host "Not replaced"
        exit 0
    }
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Compress-Archive -LiteralPath $policyFolder -DestinationPath $zipPath -Force
Write-Host "Zipped '$policyFolder' to '$zipPath'" -ForegroundColor Green
