<#
.SYNOPSIS
Asks, step by step, what Run-Project.ps1 -Interactive should run, and returns the commands.

.DESCRIPTION
Dot-source this file, then call Read-InteractiveRun. Each question shows its default in brackets, which Enter accepts.
The answers only build Run-Project.ps1 parameters: the caller prints them as plain command lines, asks once more, and
runs each by splatting them onto Run-Project.ps1 itself, so validation, .env handling and -WhatIf behave as on the
command line. Questions follow the task chosen first: a Summarise or View results has no environment, options or clearing (and
nothing runs after View results, which serves until Ctrl+C), and only a
fresh run (Quote pages or One policy) offers to clear the output first (listing what that deletes only once asked,
then confirming), as a retry needs the earlier results.
Each question starts after a blank line; choices are listed one per line under a cyan heading, prompts are green,
hints grey and corrections yellow.
#>

#Requires -Version 7.4
Set-StrictMode -Version Latest                   # error on undefined variables, missing properties, bad indexing
$ErrorActionPreference = 'Stop'                  # non-terminating errors become terminating
$PSNativeCommandUseErrorActionPreference = $true # non-zero exit codes from native commands (git, kubectl, go…) throw

. (Join-Path $PSScriptRoot 'Get-EnvFileValue.ps1')
. (Join-Path $PSScriptRoot 'Get-RunNameProblem.ps1')

# What -Interactive can run, in the order it offers them; the first is the default
$interactiveTasks = @('Quote pages', 'Retry failed', 'Retry different', 'One policy', 'Summarise only', 'View results')

# The environments -Environment takes
$interactiveEnvironments = @('dev', 'tst', 'stg')

<#
.SYNOPSIS
Asks what to run and how, and returns the Run-Project.ps1 commands to run in order.

.PARAMETER DotEnvPath
The project's .env, for the default environment and OUTPUT_DIR (to find a named run's recorded environment).

.PARAMETER ShowConfig
Prints the settings for an environment and run name (its two arguments); called before asking to continue.

.PARAMETER ShowClearOutput
Lists what clearing would delete for an environment and run name (its two arguments); called once clearing is wanted,
before asking to delete.

.OUTPUTS
An array of ordered dictionaries, one per Run-Project.ps1 command, mapping each parameter name to its value ($true
for a switch); empty when the user stops at the settings.
#>
function Read-InteractiveRun {
    param(
        [string]$DotEnvPath,
        [scriptblock]$ShowConfig,
        [scriptblock]$ShowClearOutput
    )

    $task = Read-InteractiveChoice 'What to run' $interactiveTasks $interactiveTasks[0]
    $taskParameters = Read-TaskParameters $task
    $runName = Read-InteractiveRunName
    # Summarising and viewing only read a run's output, so they need no environment
    $environment = if ($task -in @('Summarise only', 'View results')) {
        $null
    }
    else {
        Read-InteractiveEnvironment $DotEnvPath $runName
    }

    Write-Host ''
    & $ShowConfig $environment $runName
    if (!(Read-InteractiveYesNo 'Continue' $true)) {
        return , @()
    }

    $common = Get-CommonParameters $environment $runName
    $summarise = Join-RunProjectParameters ([ordered]@{ Summarise = $true }) (Get-CommonParameters $null $runName)
    $steps = [System.Collections.Generic.List[object]]::new()
    if ($task -eq 'Summarise only') {
        $steps.Add($summarise)
        return , $steps.ToArray()
    }

    # The viewer runs until Ctrl+C, so nothing follows it
    if ($task -eq 'View results') {
        $steps.Add((Join-RunProjectParameters ([ordered]@{ Serve = $true }) (Get-CommonParameters $null $runName)))
        return , $steps.ToArray()
    }

    # Asked first, so the listing appears only once clearing is wanted, then confirmed against what it would delete
    if ($task -in @('Quote pages', 'One policy') -and (Read-InteractiveYesNo 'Clear the output first' $false)) {
        Write-Host ''
        & $ShowClearOutput $environment $runName
        if (Read-InteractiveYesNo 'Delete these' $false) {
            $steps.Add((Join-RunProjectParameters ([ordered]@{ ClearOutput = $true }) $common))
        }
    }

    # A run is always followed by a Summarise, which reports what it compared and why any policy failed
    $steps.Add((Join-RunProjectParameters $taskParameters $common (Read-RunOptions $task)))
    $steps.Add($summarise)

    return , $steps.ToArray()
}

<#
.SYNOPSIS
Formats Run-Project.ps1 parameters as the command line that runs them, quoting values with spaces or a leading dash.
#>
function Format-InteractiveCommand([System.Collections.IDictionary]$parameters) {
    $parts = foreach ($name in $parameters.Keys) {
        $value = $parameters[$name]
        if ($value -is [bool]) {
            "-$name"
        }
        elseif ("$value" -match '\s|^-') {
            "-$name '$("$value" -replace "'", "''")'"
        }
        else {
            "-$name $value"
        }
    }

    return "./Run-Project.ps1 $($parts -join ' ')"
}

<#
.SYNOPSIS
Joins Run-Project.ps1 parameters, in order, into one ordered dictionary.
#>
function Join-RunProjectParameters {
    $joined = [ordered]@{}
    foreach ($parameters in $args) {
        foreach ($name in $parameters.Keys) {
            $joined[$name] = $parameters[$name]
        }
    }

    return $joined
}

# Asks the task's own questions and returns its Run-Project.ps1 parameters
function Read-TaskParameters([string]$task) {
    switch ($task) {
        'Quote pages' {
            $selection = Read-InteractiveValue 'How many policies, or one policy GUID' '250' {
                param($value)

                if ($value -notmatch '^([1-9]\d*|[0-9a-fA-F]{32})$') {
                    'Enter a whole number of 1 or more, or a 32-character policy GUID.'
                }
            }

            if ($selection -match '^[0-9a-fA-F]{32}$') {
                return [ordered]@{ QuotePages = $true; Guid = $selection }
            }

            return [ordered]@{ QuotePages = $true; MaxCount = $selection }
        }

        'Retry failed' {
            return [ordered]@{ RetryFailed = $true }
        }

        'Retry different' {
            return [ordered]@{ RetryDifferent = $true }
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

            return [ordered]@{ QuotePage = $true; PolicyDetailsId = $policyDetailsId; HistoryId = $historyId }
        }

        default {
            return [ordered]@{}
        }
    }
}

# Asks for a run name, asking again while it is not a valid folder name; blank means the environment's own folder
function Read-InteractiveRunName {
    return Read-InteractiveValue 'Run name' '' {
        param($value)

        if ($value) {
            $problem = Get-RunNameProblem $value
            if ($problem) {
                "Run name `"$value`" $problem."
            }
        }
    } "Blank for the environment's own folder (OUTPUT_DIR/<environment>), or a name for OUTPUT_DIR/<name>."
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

    # A relative OUTPUT_DIR is the project's, as the npm commands run from the project folder (beside .env)
    if (![System.IO.Path]::IsPathRooted($outputDir)) {
        $outputDir = Join-Path (Split-Path $dotEnvPath -Parent) $outputDir
    }

    $runInfoPath = Join-Path $outputDir $runName 'run.json'
    if (!(Test-Path -LiteralPath $runInfoPath -PathType Leaf)) {
        return $null
    }

    try {
        $runInfo = Get-Content -LiteralPath $runInfoPath -Raw | ConvertFrom-Json
        $recorded = $runInfo.PSObject.Properties['environment']?.Value
        # An environment -Environment does not take cannot be offered, so it is left to the npm check
        if ($recorded -in $interactiveEnvironments) {
            return $recorded
        }

        return $null
    }
    catch {
        return $null
    }
}

# Asks for the run options: concurrency (not for one policy), skipping OCR and not fetching MRP files
function Read-RunOptions([string]$task) {
    $options = [ordered]@{}
    if ($task -ne 'One policy') {
        $concurrency = Read-InteractiveValue 'Policies run at once' '3' {
            param($value)

            if ($value -notmatch '^\d+$' -or [int]$value -lt 1 -or [int]$value -gt 100) {
                'Enter a whole number from 1 to 100.'
            }
        }

        if ($concurrency -ne '3') {
            $options.Concurrency = $concurrency
        }

        if (Read-InteractiveYesNo 'Use only MRP files already saved (no fetch)' $false) {
            $options.NoFetch = $true
        }
    }

    if (Read-InteractiveYesNo 'Compare pixels only (no OCR)' $false) {
        $options.NoOcr = $true
    }

    return $options
}

# The parameters every command of the run shares: the environment (when asked) and the run name (when given)
function Get-CommonParameters([string]$environment, [string]$runName) {
    $parameters = [ordered]@{}
    if ($environment) {
        $parameters.Environment = $environment
    }

    if ($runName) {
        $parameters.RunName = $runName
    }

    return $parameters
}

# Asks one of a fixed list of choices, listed one per line under a heading, by number or name; Enter takes the default
function Read-InteractiveChoice([string]$heading, [string[]]$choices, [string]$default) {
    Write-Host ''
    Write-Host $heading -ForegroundColor Cyan
    for ($index = 0; $index -lt $choices.Count; $index++) {
        Write-Host "  $($index + 1). $($choices[$index])" -NoNewline
        if ($choices[$index] -eq $default) {
            Write-Host ' (default)' -ForegroundColor DarkGray -NoNewline
        }

        Write-Host ''
    }

    $defaultNumber = [array]::IndexOf($choices, $default) + 1
    while ($true) {
        $answer = Read-InteractiveAnswer "Choose 1-$($choices.Count)" "$defaultNumber"
        if (!$answer) {
            return $default
        }

        $number = 0
        if ([int]::TryParse($answer, [ref]$number) -and $number -ge 1 -and $number -le $choices.Count) {
            return $choices[$number - 1]
        }

        $match = @($choices | Where-Object { $_ -ieq $answer })
        if ($match.Count -gt 0) {
            return $match[0]
        }

        Write-Host "Choose 1 to $($choices.Count), or one of: $($choices -join ', ')." -ForegroundColor Yellow
    }
}

# Asks for a value after a blank line (and an optional grey hint), asking again while the check returns a problem;
# Enter takes the default when there is one
# $default is untyped: as a [string], $null (no default) would become ''
function Read-InteractiveValue([string]$prompt, $default, [scriptblock]$check, [string]$hint) {
    Write-Host ''
    if ($hint) {
        Write-Host $hint -ForegroundColor DarkGray
    }

    while ($true) {
        $answer = Read-InteractiveAnswer $prompt $default
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

# Asks a yes or no question after a blank line; Enter takes the default
function Read-InteractiveYesNo([string]$prompt, [bool]$default) {
    $hint = if ($default) {
        'Y/n'
    }
    else {
        'y/N'
    }

    Write-Host ''
    while ($true) {
        $answer = Read-InteractiveAnswer "${prompt}?" $hint
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

# Shows the prompt in green, with its default in brackets, and reads the trimmed answer
function Read-InteractiveAnswer([string]$prompt, $default) {
    $label = if ($null -eq $default) {
        "${prompt}: "
    }
    else {
        "$prompt [$default]: "
    }

    Write-Host $label -ForegroundColor Green -NoNewline
    return "$(Read-Host)".Trim()
}
