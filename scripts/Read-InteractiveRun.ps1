<#
.SYNOPSIS
Asks, step by step, what Run-Project.ps1 -Interactive should run, and returns the commands.

.DESCRIPTION
Dot-source this file, then call Read-InteractiveRun. Each question shows its default in brackets, which Enter accepts.
The answers only build Run-Project.ps1 argument lists: the caller prints them as plain command lines, asks once more,
and runs each by calling Run-Project.ps1 itself, so validation, .env handling and -WhatIf behave as on the command line.
Questions follow the task chosen first: a Summarise has no environment, options or clearing, and only a fresh run
(Quote pages or One policy) offers to clear the output first, as a retry needs the earlier results.
#>

. (Join-Path $PSScriptRoot 'Get-EnvFileValue.ps1')
. (Join-Path $PSScriptRoot 'Get-RunNameProblem.ps1')

# What -Interactive can run, in the order it offers them; the first is the default
$interactiveTasks = @('Quote pages', 'Retry failed', 'Retry different', 'One policy', 'Summarise only')

# The environments -Environment takes
$interactiveEnvironments = @('dev', 'tst', 'stg')

<#
.SYNOPSIS
Asks what to run and how, and returns the Run-Project.ps1 argument lists to run in order.

.PARAMETER DotEnvPath
The project's .env, for the default environment and OUTPUT_DIR (to find a named run's recorded environment).

.PARAMETER ShowConfig
Prints the settings for an environment and run name (its two arguments); called before asking to continue.

.PARAMETER ShowClearOutput
Lists what clearing would delete for an environment and run name (its two arguments); called before asking to clear.

.OUTPUTS
An array of argument arrays, one per Run-Project.ps1 command; empty when the user stops at the settings.
#>
function Read-InteractiveRun {
    param(
        [string]$DotEnvPath,
        [scriptblock]$ShowConfig,
        [scriptblock]$ShowClearOutput
    )

    $task = Read-InteractiveChoice 'What to run' $interactiveTasks $interactiveTasks[0]
    # @() keeps a one-argument list (such as -RetryFailed) an array, which PowerShell would otherwise unwrap to a string
    $taskArguments = @(Read-TaskArguments $task)
    $runName = Read-InteractiveRunName
    $environment = if ($task -eq 'Summarise only') {
        $null
    }
    else {
        Read-InteractiveEnvironment $DotEnvPath $runName
    }

    & $ShowConfig $environment $runName
    if (!(Read-InteractiveYesNo 'Continue' $true)) {
        return , @()
    }

    $commonArguments = @(Get-CommonArguments $environment $runName)
    $steps = [System.Collections.Generic.List[object]]::new()
    if ($task -in @('Quote pages', 'One policy')) {
        & $ShowClearOutput $environment $runName
        if (Read-InteractiveYesNo 'Clear the output first' $false) {
            $steps.Add(@('-ClearOutput') + $commonArguments)
        }
    }

    if ($task -eq 'Summarise only') {
        $steps.Add(@('-Summarise') + @(Get-CommonArguments $null $runName))
        return , $steps.ToArray()
    }

    $steps.Add($taskArguments + $commonArguments + @(Read-RunOptions $task))
    if (Read-InteractiveYesNo 'Summarise afterwards' $true) {
        $steps.Add(@('-Summarise') + @(Get-CommonArguments $null $runName))
    }

    return , $steps.ToArray()
}

<#
.SYNOPSIS
Formats a Run-Project.ps1 argument list as the command line that runs it, quoting arguments with spaces.
#>
function Format-InteractiveCommand([string[]]$arguments) {
    $quoted = $arguments | ForEach-Object {
        if ($_ -match '\s') {
            "'$($_ -replace "'", "''")'"
        }
        else {
            $_
        }
    }

    return "./Run-Project.ps1 $($quoted -join ' ')"
}

# Asks the task's own questions and returns its Run-Project.ps1 arguments
function Read-TaskArguments([string]$task) {
    switch ($task) {
        'Quote pages' {
            $selection = Read-InteractiveValue 'How many policies, or one policy GUID' '250' {
                param($value)

                if ($value -notmatch '^([1-9]\d*|[0-9a-fA-F]{32})$') {
                    'Enter a whole number of 1 or more, or a 32-character policy GUID.'
                }
            }

            if ($selection -match '^[0-9a-fA-F]{32}$') {
                return @('-QuotePages', '-Guid', $selection)
            }

            return @('-QuotePages', '-MaxCount', $selection)
        }

        'Retry failed' {
            return @('-RetryFailed')
        }

        'Retry different' {
            return @('-RetryDifferent')
        }

        'One policy' {
            $policyDetailsId = Read-InteractiveValue 'Policy details ID' $null {
                param($value)

                if ($value -notmatch '^[0-9a-fA-F]{32}$') {
                    'Enter the policy details ID: 32 hex characters, without dashes.'
                }
            }

            $historyId = Read-InteractiveValue 'History ID' '1' {
                param($value)

                if ($value -notmatch '^\d+$') {
                    'Enter a whole number of 0 or more.'
                }
            }

            return @('-QuotePage', '-PolicyDetailsId', $policyDetailsId, '-HistoryId', $historyId)
        }

        default {
            return @()
        }
    }
}

# Asks for a run name, asking again while it is not a valid folder name; blank means the environment's own folder
function Read-InteractiveRunName {
    return Read-InteractiveValue 'Run name (blank for the environment''s own folder)' '' {
        param($value)

        if ($value) {
            $problem = Get-RunNameProblem $value
            if ($problem) {
                "Run name `"$value`" $problem."
            }
        }
    }
}

# Asks for the environment. A named run that already has a run.json defaults to the environment it was made with, and
# refuses another, as its replacement quote GUIDs only exist there; otherwise the default is the one in .env.
function Read-InteractiveEnvironment([string]$dotEnvPath, [string]$runName) {
    $recorded = Get-RecordedRunEnvironment $dotEnvPath $runName
    $default = if ($recorded) {
        $recorded
    }
    else {
        $fromDotEnv = Get-EnvFileValue $dotEnvPath 'QUOTE_JOURNEY_ENVIRONMENT'
        if ($fromDotEnv -in $interactiveEnvironments) {
            $fromDotEnv
        }
        else {
            $interactiveEnvironments[0]
        }
    }

    while ($true) {
        $environment = Read-InteractiveChoice 'Environment' $interactiveEnvironments $default
        if (!$recorded -or $environment -eq $recorded) {
            return $environment
        }

        Write-Host "Run '$runName' was made with $recorded; its replacement quote GUIDs only exist there." -ForegroundColor Yellow
    }
}

# Returns the environment a named run's run.json records, or $null when there is none (or OUTPUT_DIR cannot be found
# without expanding a reference). OUTPUT_DIR comes from .env first, as the npm commands read it.
function Get-RecordedRunEnvironment([string]$dotEnvPath, [string]$runName) {
    if (!$runName) {
        return $null
    }

    $outputDir = Get-EnvFileValue $dotEnvPath 'OUTPUT_DIR'
    if (!$outputDir) {
        $outputDir = $env:OUTPUT_DIR
    }

    if (!$outputDir -or $outputDir.Contains('${')) {
        return $null
    }

    $runInfoPath = Join-Path $outputDir $runName 'run.json'
    if (!(Test-Path -LiteralPath $runInfoPath -PathType Leaf)) {
        return $null
    }

    try {
        return (Get-Content -LiteralPath $runInfoPath -Raw | ConvertFrom-Json).environment
    }
    catch {
        return $null
    }
}

# Asks for the run options: concurrency (not for one policy), skipping OCR and not fetching MRP files
function Read-RunOptions([string]$task) {
    $arguments = @()
    if ($task -ne 'One policy') {
        $concurrency = Read-InteractiveValue 'Policies run at once' '3' {
            param($value)

            if ($value -notmatch '^\d+$' -or [int]$value -lt 1 -or [int]$value -gt 100) {
                'Enter a whole number from 1 to 100.'
            }
        }

        if ($concurrency -ne '3') {
            $arguments += @('-Concurrency', $concurrency)
        }

        if (Read-InteractiveYesNo 'Use only MRP files already saved (no fetch)' $false) {
            $arguments += '-NoFetch'
        }
    }

    if (Read-InteractiveYesNo 'Compare pixels only (no OCR)' $false) {
        $arguments += '-NoOcr'
    }

    return $arguments
}

# The arguments every command of the run shares: the environment (when asked) and the run name (when given)
function Get-CommonArguments([string]$environment, [string]$runName) {
    $arguments = @()
    if ($environment) {
        $arguments += @('-Environment', $environment)
    }

    if ($runName) {
        $arguments += @('-RunName', $runName)
    }

    return $arguments
}

# Asks one of a fixed list of choices, by number or name; Enter takes the default
function Read-InteractiveChoice([string]$prompt, [string[]]$choices, [string]$default) {
    $numbered = for ($index = 0; $index -lt $choices.Count; $index++) {
        "$($index + 1). $($choices[$index])"
    }

    Write-Host "$prompt`: $($numbered -join ', ')"
    while ($true) {
        $answer = (Read-Host "$prompt [$default]").Trim()
        if (!$answer) {
            return $default
        }

        $number = 0
        if ([int]::TryParse($answer, [ref]$number) -and $number -ge 1 -and $number -le $choices.Count) {
            return $choices[$number - 1]
        }

        $match = $choices | Where-Object { $_ -ieq $answer } | Select-Object -First 1
        if ($match) {
            return $match
        }

        Write-Host "Choose 1 to $($choices.Count), or one of: $($choices -join ', ')." -ForegroundColor Yellow
    }
}

# Asks for a value, asking again while the check returns a problem; Enter takes the default (when there is one)
function Read-InteractiveValue([string]$prompt, [string]$default, [scriptblock]$check) {
    $label = if ($null -eq $default) {
        $prompt
    }
    elseif ($default -eq '') {
        "$prompt []"
    }
    else {
        "$prompt [$default]"
    }

    while ($true) {
        $answer = (Read-Host $label).Trim()
        if (!$answer) {
            if ($null -eq $default) {
                Write-Host 'An answer is needed.' -ForegroundColor Yellow
                continue
            }

            $answer = $default
        }

        $problem = & $check $answer
        if (!$problem) {
            return $answer
        }

        Write-Host $problem -ForegroundColor Yellow
    }
}

# Asks a yes or no question; Enter takes the default
function Read-InteractiveYesNo([string]$prompt, [bool]$default) {
    $hint = if ($default) {
        'Y/n'
    }
    else {
        'y/N'
    }

    while ($true) {
        $answer = (Read-Host "$prompt? [$hint]").Trim()
        if (!$answer) {
            return $default
        }

        if ($answer -match '^(y|yes)$') {
            return $true
        }

        if ($answer -match '^(n|no)$') {
            return $false
        }

        Write-Host 'Answer y or n.' -ForegroundColor Yellow
    }
}
