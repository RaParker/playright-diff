<#
.SYNOPSIS
Runs any of this project's commands or development tasks with validated parameters.

.DESCRIPTION
One entry point for the playwright-diff CLI (screenshot, compare, quote-page, quote-pages, summarise,
migrate-output, clear-output) and its development tasks. Each command is a switch with its own parameter set, so tab completion
only offers options that apply, and inputs are validated before Node starts.

CLI commands run src/main.ts through tsx (as the npm scripts do) from the project root, so .env is always read from
there. Output is kept per environment in DIFF_OUTPUT_DIR/<environment> (for example D:/temp/output/dev): each policy's
<policyDetailsId>-<historyId> folder, quote-guid-mapping.json and quote-pages-failed.json. MRP files are likewise read
from MRP_AND_QUOTE_OUTPUT_DIR/<environment>. Relative paths you pass are resolved from your current directory first.

QuotePage, QuotePages, RetryFailed and RetryDifferent run against -Environment (default: dev). The script writes it to
.env first (QUOTE_JOURNEY_ENVIRONMENT and QUOTE_JOURNEY_HOST), so the setting stays until the next of these commands;
Summarise and ClearOutput use the environment in .env (ClearOutput also takes -Environment).

Run it with no arguments for an overview of the commands in the order they're used. Use -WhatIf to print the command
(and any .env change) without running it. The script exits with the command's exit code.

Keep these parameters in step with the options in src/main.ts when the CLI changes.

.PARAMETER Screenshot
Capture a full-page screenshot of -Url.

.PARAMETER Url
http or https URL to capture.

.PARAMETER Output
Screenshot: PNG or JPEG output file (default: screenshots/screenshot.png in DIFF_OUTPUT_DIR).
Compare: new report directory (default: comparisons/run-<timestamp> in DIFF_OUTPUT_DIR).

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

.PARAMETER RetryDifferent
Rerun every policy in DIFF_OUTPUT_DIR whose screenshots differed (the summarise "differences" count). Leaves
quote-pages-failed.json untouched.

.PARAMETER Summarise
Summarise every policy folder: differences and their text, failures and their reasons, MRP records not
retrieved, and totals including the GUID list size and Oops pages. Alias: -Summarize.

.PARAMETER Mode
Summarise only: differences (only the policies whose screenshots differed) or changed-answers (combine and count
every policy's answer changes). Without it, the full summary is shown.

.PARAMETER MigrateOutput
Move output from the old layout (screenshots/ and comparisons/<policyDetailsId>-<historyId>/) into one
<policyDetailsId>-<historyId>/ folder per policy. Without -Apply it only lists what would move.

.PARAMETER Apply
MigrateOutput only: move the files rather than listing them.

.PARAMETER Root
MigrateOutput only: output folder to migrate (default: DIFF_OUTPUT_DIR, or the project root).

.PARAMETER ClearOutput
Delete the environment's output folder (DIFF_OUTPUT_DIR/<environment>) and everything in it, after printing the folder
and how many entries it holds. That includes its quote-guid-mapping.json, a known cause of every policy failing with
NHI Oops (README: Troubleshooting), so the next run requests fresh replacement quote GUIDs. Other environments' folders
are kept. Uses the environment in .env unless -Environment is given. Refuses when DIFF_OUTPUT_DIR is not set, or the
folder is a drive root, the user profile, this project or a folder containing either.

.PARAMETER NoOcr
Compare pixels without extracting text.

.PARAMETER NoFetch
QuotePages, RetryFailed and RetryDifferent: use only the MRP files already saved, without running mrp-and-quote's
fetch for missing ones (those policies fail). Without it, only missing MRP files are fetched; existing ones are reused.

.PARAMETER Concurrency
Quote pages, RetryFailed and RetryDifferent: number of policies run at once (default: 3; 1 runs them in turn).

.PARAMETER Environment
QuotePage, QuotePages, RetryFailed and RetryDifferent: environment to run against, dev, tst or stg (default: dev).
ClearOutput: environment whose output folder to delete (default: the one already in .env).
Before the command runs, .env's QUOTE_JOURNEY_ENVIRONMENT is set to it and QUOTE_JOURNEY_HOST to its Quote Journey
host: quotes-feature-dev, quotes-feature-tst or quotes-stg (.homeprotect.co.uk; feature builds only reach dev and tst).
The MRP fetch reads from the same environment. .env is only written when it changes.

.PARAMETER Task
Development task: Install (npm install), InstallBrowser (Playwright Chromium), Build, Typecheck, Lint,
Test (all suites), TestCompare, TestQuotePage or Verify (VerifyProject.ps1).

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
./Run-Project.ps1 -QuotePages -MaxCount 10 -Environment tst

.EXAMPLE
./Run-Project.ps1 -QuotePages -MaxCount 1300 -Concurrency 5

.EXAMPLE
./Run-Project.ps1 -RetryFailed

.EXAMPLE
./Run-Project.ps1 -RetryDifferent

.EXAMPLE
./Run-Project.ps1 -Summarise

.EXAMPLE
./Run-Project.ps1 -Summarise -Mode changed-answers

.EXAMPLE
./Run-Project.ps1 -MigrateOutput -Root D:/temp/playright-diff-output-full

.EXAMPLE
./Run-Project.ps1 -MigrateOutput -Root D:/temp/playright-diff-output-full -Apply

.EXAMPLE
./Run-Project.ps1 -ClearOutput

.EXAMPLE
./Run-Project.ps1 -ClearOutput -Environment tst

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

    [Parameter(Mandatory, ParameterSetName = 'RetryDifferent')]
    [switch]$RetryDifferent,

    [Parameter(Mandatory, ParameterSetName = 'Summarise')]
    [Alias('Summarize')]
    [switch]$Summarise,

    [Parameter(ParameterSetName = 'Summarise')]
    [ValidateSet('differences', 'changed-answers')]
    [string]$Mode,

    [Parameter(Mandatory, ParameterSetName = 'MigrateOutput')]
    [switch]$MigrateOutput,

    [Parameter(ParameterSetName = 'MigrateOutput')]
    [switch]$Apply,

    [Parameter(ParameterSetName = 'MigrateOutput')]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Container }, ErrorMessage = 'Output folder "{0}" does not exist.')]
    [string]$Root,

    [Parameter(Mandatory, ParameterSetName = 'ClearOutput')]
    [switch]$ClearOutput,

    [Parameter(ParameterSetName = 'Compare')]
    [Parameter(ParameterSetName = 'QuotePage')]
    [Parameter(ParameterSetName = 'QuotePages')]
    [Parameter(ParameterSetName = 'QuotePagesCount')]
    [Parameter(ParameterSetName = 'QuotePagesGuid')]
    [Parameter(ParameterSetName = 'RetryFailed')]
    [Parameter(ParameterSetName = 'RetryDifferent')]
    [switch]$NoOcr,

    [Parameter(ParameterSetName = 'QuotePages')]
    [Parameter(ParameterSetName = 'QuotePagesCount')]
    [Parameter(ParameterSetName = 'QuotePagesGuid')]
    [Parameter(ParameterSetName = 'RetryFailed')]
    [Parameter(ParameterSetName = 'RetryDifferent')]
    [ValidateRange(1, 100)]
    [int]$Concurrency,

    [Parameter(ParameterSetName = 'QuotePages')]
    [Parameter(ParameterSetName = 'QuotePagesCount')]
    [Parameter(ParameterSetName = 'QuotePagesGuid')]
    [Parameter(ParameterSetName = 'RetryFailed')]
    [Parameter(ParameterSetName = 'RetryDifferent')]
    [switch]$NoFetch,

    [Parameter(ParameterSetName = 'QuotePage')]
    [Parameter(ParameterSetName = 'QuotePages')]
    [Parameter(ParameterSetName = 'QuotePagesCount')]
    [Parameter(ParameterSetName = 'QuotePagesGuid')]
    [Parameter(ParameterSetName = 'RetryFailed')]
    [Parameter(ParameterSetName = 'RetryDifferent')]
    [Parameter(ParameterSetName = 'ClearOutput')]
    [ValidateSet('dev', 'tst', 'stg')]
    [string]$Environment = 'dev',

    [Parameter(Mandatory, ParameterSetName = 'Task')]
    [ValidateSet('Install', 'InstallBrowser', 'Build', 'Typecheck', 'Lint', 'Test', 'TestCompare', 'TestQuotePage', 'Verify')]
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
    Verify = 'VerifyProject.ps1'
}

# Quote Journey host of each -Environment. Feature builds only deploy to dev and tst, so stg runs main.
$quoteJourneyHostByEnvironment = @{
    dev = 'quotes-feature-dev.homeprotect.co.uk'
    stg = 'quotes-stg.homeprotect.co.uk'
    tst = 'quotes-feature-tst.homeprotect.co.uk'
}

# The commands that open the quote journey, and so always apply -Environment (default dev) to .env
$environmentParameterSets = @('QuotePage', 'QuotePages', 'QuotePagesCount', 'QuotePagesGuid', 'RetryFailed', 'RetryDifferent')

# -ClearOutput only switches .env when -Environment is given; otherwise it clears the environment already there
$appliesEnvironment = ($environmentParameterSets -contains $PSCmdlet.ParameterSetName) -or
($PSCmdlet.ParameterSetName -eq 'ClearOutput' -and $PSBoundParameters.ContainsKey('Environment'))

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
            return @('quote-pages') + (Get-QuotePagesSelector) + (Get-QuotePagesOptionArguments) + (Get-NoOcrArgument)
        }

        'RetryFailed' {
            return @('quote-pages', 'retry-failed') + (Get-QuotePagesOptionArguments) + (Get-NoOcrArgument)
        }

        'RetryDifferent' {
            return @('quote-pages', 'retry-different') + (Get-QuotePagesOptionArguments) + (Get-NoOcrArgument)
        }

        'Summarise' {
            $arguments = @('summarise')
            if ($Mode) {
                $arguments += $Mode
            }

            return $arguments
        }

        'MigrateOutput' {
            $arguments = @('migrate-output') + (Get-OptionArguments @{ root = Resolve-UserPath $Root })
            if ($Apply) {
                $arguments += @('--apply')
            }

            return $arguments
        }

        'ClearOutput' {
            # With -WhatIf the CLI lists the folder it would delete, rather than the command only being printed
            if ($WhatIfPreference) {
                return @('clear-output', '--dry-run')
            }

            return @('clear-output')
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

function Get-QuotePagesOptionArguments {
    $arguments = Get-OptionArguments @{ concurrency = $Concurrency }

    if ($NoFetch) {
        $arguments += @('--no-fetch')
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

<#
.SYNOPSIS
Points .env at -Environment: sets QUOTE_JOURNEY_ENVIRONMENT to it and QUOTE_JOURNEY_HOST to its Quote Journey host.

.DESCRIPTION
Only those two lines change, keeping the file's line endings, and the file is only written when one of them differs.
Honours -WhatIf and -Confirm. Throws when .env has no line for either setting, since the URL templates would then
keep pointing at another environment.
#>
function Set-DotEnvEnvironment {
    $dotEnvPath = Join-Path $PSScriptRoot '.env'
    $quoteJourneyHost = $quoteJourneyHostByEnvironment[$Environment]
    $original = [System.IO.File]::ReadAllText($dotEnvPath)

    $updated = Set-DotEnvValue $original 'QUOTE_JOURNEY_ENVIRONMENT' $Environment
    $updated = Set-DotEnvValue $updated 'QUOTE_JOURNEY_HOST' $quoteJourneyHost

    Write-Host "Environment: $Environment ($quoteJourneyHost)" -ForegroundColor DarkGray
    if ($updated -ceq $original) {
        return
    }

    $action = "Set QUOTE_JOURNEY_ENVIRONMENT=$Environment and QUOTE_JOURNEY_HOST=$quoteJourneyHost"
    if ($PSCmdlet.ShouldProcess($dotEnvPath, $action)) {
        [System.IO.File]::WriteAllText($dotEnvPath, $updated)
        Write-Host "Switched .env to $Environment." -ForegroundColor Yellow
    }
}

# Returns the .env text with the name=... line set to value; [^\r\n] keeps a CRLF line's \r in place
function Set-DotEnvValue([string]$text, [string]$name, [string]$value) {
    $pattern = "(?m)^$([regex]::Escape($name))=[^\r\n]*"
    if ($text -notmatch $pattern) {
        throw ".env has no $name line, so -Environment cannot be applied. Add $name=... (see the README's Configuration)."
    }

    # $$ keeps a $ in the value literal in the replacement
    return [regex]::Replace($text, $pattern, "$name=$($value.Replace('$', '$$'))")
}

function Format-CommandLine([string[]]$command) {
    return ($command | ForEach-Object { if ($_ -match '\s') {
                "`"$_`""
            }
            else {
                $_
            } }) -join ' '
}

# The no-arguments overview, in the order the commands are used. Each row is a command (depth 0) or one of its options
# (depth 1), its usage, and what it does; a row with only a description is a note. Get-Help still shows the full
# per-parameter reference, so keep this short, and add any new command or parameter here as well (a test checks).
$overviewSections = @(
    @{
        Title = '1. Set up (once)'
        Rows  = @(
            @{ Usage = '-Task Install'; Description = 'Install the npm packages' }

            @{ Usage = '-Task InstallBrowser'; Description = 'Install Playwright Chromium' }

            @{ Description = 'Then set the .env values (README: Configuration), e.g. QUOTE_GUID_LIST_PATH and DIFF_OUTPUT_DIR.' }
        )
    }

    @{
        Title = '2. Compare NHI and TCAS quote pages (main workflow, in this order)'
        Rows  = @(
            @{ Usage = '-ClearOutput'; Description = "Optional: delete this environment's output to start afresh" }

            @{ Depth = 1; Usage = '[-Environment <dev|tst|stg>]'; Description = 'Environment to clear (default: the one in .env)' }

            @{ Description = 'Also deletes its quote GUID mapping: clear it when every policy fails with NHI Oops.' }

            @{ Usage = '-QuotePages'; Description = 'Run the first 250 policies in the GUID list' }

            @{ Depth = 1; Usage = '-MaxCount <n>'; Description = '...or the first n' }

            @{ Depth = 1; Usage = '-Guid <guid>'; Description = '...or just this one' }

            @{ Usage = '-Summarise'; Description = 'Read the results: differences, failures and totals' }

            @{ Depth = 1; Usage = '-Mode <differences|changed-answers>'; Description = 'Show only that part' }

            @{ Usage = '-RetryFailed'; Description = 'Rerun the policies that failed' }

            @{ Usage = '-RetryDifferent'; Description = 'Rerun the policies whose screenshots differed' }

            @{ Description = 'After a retry, run -Summarise again.' }

            @{ Description = 'Options for -QuotePages, -RetryFailed and -RetryDifferent:' }

            @{ Depth = 1; Usage = '-Environment <dev|tst|stg>'; Description = 'Environment to run against (default: dev); saved to .env, output in DIFF_OUTPUT_DIR/<env>' }

            @{ Depth = 1; Usage = '-Concurrency <n>'; Description = 'Policies run at once (default: 3)' }

            @{ Depth = 1; Usage = '-NoFetch'; Description = 'Only use MRP files already saved' }

            @{ Depth = 1; Usage = '-NoOcr'; Description = 'Compare pixels only, without reading text' }
        )
    }

    @{
        Title = '3. Single runs and tools (any time)'
        Rows  = @(
            @{ Usage = '-QuotePage -PolicyDetailsId <id> -HistoryId <n>'; Description = 'Compare one policy' }

            @{ Depth = 1; Usage = '[-Environment <dev|tst|stg>] [-NoOcr]' }

            @{ Usage = '-Screenshot -Url <url> [-Output <file>]'; Description = 'Capture one page' }

            @{ Depth = 1; Usage = '[-Width <px>] [-Height <px>] [-Wait <ms>] [-Timeout <ms>]' }

            @{ Usage = '-Compare -Before <file> -After <file>'; Description = 'Compare two images' }

            @{ Depth = 1; Usage = '[-Output <dir>] [-Threshold <0-255>] [-Language <code>] [-NoOcr]' }

            @{ Usage = '-MigrateOutput [-Root <dir>] [-Apply]'; Description = 'Move output from the old folder layout' }
        )
    }

    @{
        Title = '4. Development'
        Rows  = @(
            @{ Usage = '-Task Build | Typecheck | Lint | Test | TestCompare | TestQuotePage | Verify' }
        )
    }

    @{
        Title = 'More help'
        Rows  = @(
            @{ Usage = '-WhatIf'; Description = 'Add to any command to print it without running it' }

            @{ Usage = 'Get-Help ./Run-Project.ps1 -Parameter <Name>'; Description = 'One parameter in detail' }

            @{ Usage = 'Get-Help ./Run-Project.ps1 -Full'; Description = 'Everything' }
        )
    }
)

# Overview layout: descriptions start in this column, unless the usage is too long to fit before it
$overviewDescriptionColumn = 48
$overviewIndentByDepth = @('  ', '      ')

# Overview styles: a muted 24-bit palette. Like the CLI's own colours, they're left out when NO_COLOR is set, and also
# when output is redirected, since Write-Host passes escape codes in a string through to a file or pipe unchanged.
$useOverviewColour = [string]::IsNullOrEmpty($env:NO_COLOR) -and ![Console]::IsOutputRedirected -and
$PSStyle.OutputRendering -ne 'PlainText'

# Overview colours (24-bit RGB), named for roughly how they look
$ColorAmber = 0xE0AF68
$ColorPaleLavender = 0xC0CAF5
$ColorLightSlate = 0xA9B1D6
$ColorMutedSlate = 0x737AA2
$ColorDarkSlate = 0x565F89
$ColorSkyBlue = 0x7DCFFF
$ColorSoftBlue = 0x7AA2F7
$ColorSoftGreen = 0x9ECE6A

$overviewStyle = @{
    Title       = $PSStyle.Bold + $PSStyle.Foreground.FromRgb($ColorPaleLavender)
    Heading     = $PSStyle.Bold + $PSStyle.Foreground.FromRgb($ColorSoftBlue)
    Command     = $PSStyle.Bold + $PSStyle.Foreground.FromRgb($ColorSoftGreen)
    Option      = $PSStyle.Foreground.FromRgb($ColorAmber)
    Placeholder = $PSStyle.Italic + $PSStyle.Foreground.FromRgb($ColorSkyBlue)
    Punctuation = $PSStyle.Foreground.FromRgb($ColorDarkSlate)
    Description = $PSStyle.Foreground.FromRgb($ColorLightSlate)
    Note        = $PSStyle.Italic + $PSStyle.Foreground.FromRgb($ColorMutedSlate)
}

<#
.SYNOPSIS
Writes the no-arguments overview of the commands, grouped and ordered by when they're used.

.DESCRIPTION
Section headings are bold blue, commands bold green, their options amber, value placeholders such as <n> italic cyan,
brackets and separators dim, and notes italic grey.
#>
function Write-Overview {
    $title = (Format-Styled './Run-Project.ps1' $overviewStyle.Command) +
    (Format-Styled " - runs this project's commands and development tasks." $overviewStyle.Title)
    Write-Host $title
    Write-Host

    foreach ($section in $overviewSections) {
        Write-Host (Format-Styled $section.Title $overviewStyle.Heading)
        foreach ($row in $section.Rows) {
            Write-Host (Format-OverviewRow $row)
        }

        Write-Host
    }
}

# Returns one row as styled text: its usage, then its description lined up in a column (on the next line when the
# usage is too long), or just the note when the row has no usage
function Format-OverviewRow([hashtable]$row) {
    $indent = $overviewIndentByDepth[[int]$row.Depth]
    if (!$row.Usage) {
        return $indent + (Format-Styled $row.Description $overviewStyle.Note)
    }

    $usageStyle = if ($row.Depth) {
        $overviewStyle.Option
    }
    else {
        $overviewStyle.Command
    }

    $text = $indent + (Format-Usage $row.Usage $usageStyle)
    if (!$row.Description) {
        return $text
    }

    $usedWidth = $indent.Length + $row.Usage.Length
    if ($usedWidth -ge $overviewDescriptionColumn) {
        $text += "`n"
        $usedWidth = 0
    }

    return $text + (' ' * ($overviewDescriptionColumn - $usedWidth)) + (Format-Styled $row.Description $overviewStyle.Description)
}

# Styles <placeholders> and the [ ] | punctuation separately from the switches and task names around them
function Format-Usage([string]$usage, [string]$usageStyle) {
    $parts = $usage -split '(<[^>]+>|[\[\]|])' | Where-Object { $_ }

    $styledParts = foreach ($part in $parts) {
        $style = if ($part.StartsWith('<')) {
            $overviewStyle.Placeholder
        }
        elseif ($part -match '^[\[\]|]$') {
            $overviewStyle.Punctuation
        }
        else {
            $usageStyle
        }

        Format-Styled $part $style
    }

    return $styledParts -join ''
}

function Format-Styled([string]$text, [string]$style) {
    if (!$useOverviewColour) {
        return $text
    }

    return "$style$text$($PSStyle.Reset)"
}

if ($PSCmdlet.ParameterSetName -eq 'Help') {
    Write-Overview
    exit 0
}

# Option names match the CLI flags; only parameters the caller passed are forwarded so the CLI keeps its defaults.
$script:boundParameterNames = @($PSBoundParameters.Keys | ForEach-Object { $_.ToLowerInvariant() })

# Resolve user paths against the caller's directory before switching to the project root.
$command = Get-ProjectCommand
$commandLine = Format-CommandLine $command
if ($appliesEnvironment) {
    Set-DotEnvEnvironment
}

# -ClearOutput -WhatIf runs the CLI's dry run, which deletes nothing; every other -WhatIf only prints the command
$isDryRun = $PSCmdlet.ParameterSetName -eq 'ClearOutput' -and $WhatIfPreference
if (-not $isDryRun -and -not $PSCmdlet.ShouldProcess($commandLine, 'Run')) {
    exit 0
}

# -WhatIf leaves .env as it is, so the environment is passed to the command directly (it wins over .env)
$savedEnvironment = $env:QUOTE_JOURNEY_ENVIRONMENT
Push-Location $PSScriptRoot
try {
    if ($appliesEnvironment) {
        $env:QUOTE_JOURNEY_ENVIRONMENT = $Environment
    }

    Write-Host $commandLine -ForegroundColor DarkGray
    $global:LASTEXITCODE = 0
    & $command[0] @($command | Select-Object -Skip 1)
    $exitCode = $LASTEXITCODE
}
finally {
    $env:QUOTE_JOURNEY_ENVIRONMENT = $savedEnvironment
    Pop-Location
}

exit $exitCode
