<#
.SYNOPSIS
Runs any of this project's commands or development tasks with validated parameters.

.DESCRIPTION
One entry point for the playwright-diff CLI (screenshot, compare, quote-page, quote-pages) and its
development tasks. Each command is a switch with its own parameter set, so tab completion only offers
options that apply, and inputs are validated before Node starts.

CLI commands run src/main.ts through tsx (as the npm scripts do) from the project root, so .env,
quote-guid-mapping.json and quote-pages-failed.json are always read from there. Relative paths you
pass are resolved from your current directory first.

Use -WhatIf to print the command without running it. The script exits with the command's exit code.

Keep these parameters in step with the options in src/main.ts when the CLI changes.

.PARAMETER Screenshot
Capture a full-page screenshot of -Url.

.PARAMETER Url
http or https URL to capture.

.PARAMETER Output
Screenshot: PNG or JPEG output file (default: screenshots/screenshot.png).
Compare: new report directory (default: comparisons/run-<timestamp>).

.PARAMETER Width
Viewport width in pixels (default: 1440).

.PARAMETER Height
Viewport height in pixels (default: 900).

.PARAMETER Wait
Extra delay in milliseconds after scrolling (default: 1000).

.PARAMETER Timeout
Navigation/action timeout in milliseconds (default: 30000).

.PARAMETER Compare
Compare two images and report changed regions and text.

.PARAMETER Before
Existing "before" image file.

.PARAMETER After
Existing "after" image file.

.PARAMETER Threshold
Ignore channel differences up to this value, 0-255 (default: 20; 0 = exact).

.PARAMETER Language
Tesseract OCR language code, for example eng or eng+fra (default: eng).

.PARAMETER QuotePage
Capture the NHI and TCAS quote pages for one policy and compare them.

.PARAMETER PolicyDetailsId
Policy details ID: a UUID with dashes removed (32 hex characters).

.PARAMETER HistoryId
Policy history ID (non-negative integer).

.PARAMETER QuotePages
Run quote-page (history ID 1) for the policies in QUOTE_GUID_LIST_PATH: the first 250 by default,
the first -MaxCount, or the single -Guid.

.PARAMETER MaxCount
Number of entries to run from the start of the GUID list.

.PARAMETER Guid
One GUID list entry to run (32 hex characters, case-insensitive).

.PARAMETER RetryFailed
Rerun only the policies saved in quote-pages-failed.json by the last quote-pages run.

.PARAMETER NoOcr
Compare pixels without extracting text.

.PARAMETER Task
Development task: Install (npm install), InstallBrowser (Playwright Chromium), Build, Typecheck, Lint,
Test (all suites), TestCompare, TestQuotePage, Verify (VerifyProject.ps1) or CleanUp (CleanUp.ps1).

.EXAMPLE
./Run-Project.ps1 -Screenshot -Url https://example.com -Output screenshots/example.png -Width 390 -Height 844

.EXAMPLE
./Run-Project.ps1 -Compare -Before screenshots/before.png -After screenshots/after.png -Threshold 10

.EXAMPLE
./Run-Project.ps1 -QuotePage -PolicyDetailsId ABCDEF1234567890ABCDEF1234567890 -HistoryId 42 -NoOcr

.EXAMPLE
./Run-Project.ps1 -QuotePages -MaxCount 10

.EXAMPLE
./Run-Project.ps1 -QuotePages -Guid 6819e30c2058490b8d1d9e25d267b002

.EXAMPLE
./Run-Project.ps1 -RetryFailed

.EXAMPLE
./Run-Project.ps1 -Task Verify

.EXAMPLE
./Run-Project.ps1 -QuotePages -WhatIf
#>
[CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'Help')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Screenshot')]
    [switch]$Screenshot,

    [Parameter(Mandatory, ParameterSetName = 'Screenshot')]
    [ValidatePattern('^https?://\S+$')]
    [string]$Url,

    [Parameter(ParameterSetName = 'Screenshot')]
    [Parameter(ParameterSetName = 'Compare')]
    [ValidateNotNullOrEmpty()]
    [string]$Output,

    [Parameter(ParameterSetName = 'Screenshot')]
    [ValidateRange(1, 10000)]
    [int]$Width,

    [Parameter(ParameterSetName = 'Screenshot')]
    [ValidateRange(1, 10000)]
    [int]$Height,

    [Parameter(ParameterSetName = 'Screenshot')]
    [ValidateRange(0, 600000)]
    [int]$Wait,

    [Parameter(ParameterSetName = 'Screenshot')]
    [ValidateRange(1, 600000)]
    [int]$Timeout,

    [Parameter(Mandatory, ParameterSetName = 'Compare')]
    [switch]$Compare,

    [Parameter(Mandatory, ParameterSetName = 'Compare')]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf }, ErrorMessage = 'Before image "{0}" does not exist.')]
    [string]$Before,

    [Parameter(Mandatory, ParameterSetName = 'Compare')]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf }, ErrorMessage = 'After image "{0}" does not exist.')]
    [string]$After,

    [Parameter(ParameterSetName = 'Compare')]
    [ValidateRange(0, 255)]
    [int]$Threshold,

    [Parameter(ParameterSetName = 'Compare')]
    [ValidatePattern('^[a-z_]+(\+[a-z_]+)*$')]
    [string]$Language,

    [Parameter(Mandatory, ParameterSetName = 'QuotePage')]
    [switch]$QuotePage,

    [Parameter(Mandatory, ParameterSetName = 'QuotePage')]
    [ValidatePattern('^[0-9a-fA-F]{32}$')]
    [string]$PolicyDetailsId,

    [Parameter(Mandatory, ParameterSetName = 'QuotePage')]
    [ValidateRange(0, [int]::MaxValue)]
    [int]$HistoryId,

    [Parameter(Mandatory, ParameterSetName = 'QuotePages')]
    [Parameter(Mandatory, ParameterSetName = 'QuotePagesCount')]
    [Parameter(Mandatory, ParameterSetName = 'QuotePagesGuid')]
    [switch]$QuotePages,

    [Parameter(Mandatory, ParameterSetName = 'QuotePagesCount')]
    [ValidateRange(1, [int]::MaxValue)]
    [int]$MaxCount,

    [Parameter(Mandatory, ParameterSetName = 'QuotePagesGuid')]
    [ValidatePattern('^[0-9a-fA-F]{32}$')]
    [string]$Guid,

    [Parameter(Mandatory, ParameterSetName = 'RetryFailed')]
    [switch]$RetryFailed,

    [Parameter(ParameterSetName = 'Compare')]
    [Parameter(ParameterSetName = 'QuotePage')]
    [Parameter(ParameterSetName = 'QuotePages')]
    [Parameter(ParameterSetName = 'QuotePagesCount')]
    [Parameter(ParameterSetName = 'QuotePagesGuid')]
    [Parameter(ParameterSetName = 'RetryFailed')]
    [switch]$NoOcr,

    [Parameter(Mandatory, ParameterSetName = 'Task')]
    [ValidateSet('Install', 'InstallBrowser', 'Build', 'Typecheck', 'Lint', 'Test', 'TestCompare', 'TestQuotePage', 'Verify', 'CleanUp')]
    [string]$Task
)

$ErrorActionPreference = 'Stop'

$npmScriptByTask = @{
    Install        = @('install')
    InstallBrowser = @('run', 'install:browser')
    Build          = @('run', 'build')
    Typecheck      = @('run', 'typecheck')
    Lint           = @('run', 'lint')
    Test           = @('test')
    TestCompare    = @('run', 'test:compare')
    TestQuotePage  = @('run', 'test:quote-page')
}

$projectScriptByTask = @{
    Verify  = 'VerifyProject.ps1'
    CleanUp = 'CleanUp.ps1'
}

function Get-ProjectCommand {
    if ($PSCmdlet.ParameterSetName -eq 'Task') {
        return Get-TaskCommand
    }

    return @('node', 'node_modules/tsx/dist/cli.mjs', 'src/main.ts') + (Get-CliArguments)
}

function Get-TaskCommand {
    if ($projectScriptByTask.ContainsKey($Task)) {
        return @(Join-Path $PSScriptRoot $projectScriptByTask[$Task])
    }

    return @('npm') + $npmScriptByTask[$Task]
}

function Get-CliArguments {
    switch -Wildcard ($PSCmdlet.ParameterSetName) {
        'Screenshot' {
            return @('screenshot', $Url) + (Get-OptionArguments @{
                    output  = Resolve-UserPath $Output
                    width   = $Width
                    height  = $Height
                    wait    = $Wait
                    timeout = $Timeout
                })
        }

        'Compare' {
            return @('compare', (Resolve-UserPath $Before), (Resolve-UserPath $After)) + (Get-OptionArguments @{
                    output    = Resolve-UserPath $Output
                    threshold = $Threshold
                    language  = $Language
                }) + (Get-NoOcrArgument)
        }

        'QuotePage' {
            return @('quote-page', $PolicyDetailsId, "$HistoryId") + (Get-NoOcrArgument)
        }

        'QuotePages*' {
            return @('quote-pages') + (Get-QuotePagesSelector) + (Get-NoOcrArgument)
        }

        'RetryFailed' {
            return @('quote-pages', 'retry-failed') + (Get-NoOcrArgument)
        }
    }
}

function Get-QuotePagesSelector {
    if ($PSCmdlet.ParameterSetName -eq 'QuotePagesCount') {
        return @("$MaxCount")
    }

    if ($PSCmdlet.ParameterSetName -eq 'QuotePagesGuid') {
        return @($Guid)
    }

    return @()
}

function Get-OptionArguments([hashtable]$optionValues) {
    $arguments = @()
    foreach ($name in $optionValues.Keys | Sort-Object) {
        if ($script:boundParameterNames -contains $name) {
            $arguments += @("--$name", "$($optionValues[$name])")
        }
    }

    return $arguments
}

function Get-NoOcrArgument {
    if ($NoOcr) {
        return @('--no-ocr')
    }

    return @()
}

function Resolve-UserPath([string]$path) {
    if ([string]::IsNullOrEmpty($path)) {
        return $path
    }

    return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($path)
}

function Format-CommandLine([string[]]$command) {
    return ($command | ForEach-Object { if ($_ -match '\s') {
                "`"$_`""
            }
            else {
                $_
            } }) -join ' '
}

if ($PSCmdlet.ParameterSetName -eq 'Help') {
    Get-Help $PSCommandPath -Detailed
    exit 0
}

# Option names match the CLI flags; only parameters the caller passed are forwarded so the CLI keeps its defaults.
$script:boundParameterNames = @($PSBoundParameters.Keys | ForEach-Object { $_.ToLowerInvariant() })

# Resolve user paths against the caller's directory before switching to the project root.
$command = Get-ProjectCommand
$commandLine = Format-CommandLine $command
if (-not $PSCmdlet.ShouldProcess($commandLine, 'Run')) {
    exit 0
}

Push-Location $PSScriptRoot
try {
    Write-Host $commandLine -ForegroundColor DarkGray
    $global:LASTEXITCODE = 0
    & $command[0] @($command | Select-Object -Skip 1)
    $exitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

exit $exitCode
