<#
.SYNOPSIS
Formats a script's comment-based help compactly, as an alternative to Get-Help's padded layout.

.DESCRIPTION
Dot-source this file, then call Get-ScriptHelpText. Get-Help's own layout leaves runs of blank lines after every
example and adds REMARKS and CommonParameters boilerplate, none of which comment-based help can turn off. This reads
the same help through Get-Help and lays it out with a single blank line between sections. The -WhatIf and -Confirm
parameters are left out of the parameter list (they have no description), as is any syntax line that offers no
parameters of its own, such as a 'Help' parameter set.
#>

# The width usage lines wrap at when the console's width is unknown, e.g. when output is redirected
$defaultHelpWidth = 120
# Labels longer than this get their description on the next line rather than widening the column for all of them
$maxParameterLabelWidth = 28
# Below this, parameter descriptions would wrap to a word or two per line, so they overflow the console instead
$minDescriptionWidth = 40
# Parameters PowerShell adds to a script with SupportsShouldProcess; they're left out of the parameter list
$shouldProcessParameterNames = @('WhatIf', 'Confirm')

<#
.SYNOPSIS
Returns a script's comment-based help as compact text.

.PARAMETER Path
The script whose help to format.

.OUTPUTS
The help text: the synopsis, usage lines, description, parameters and examples, separated by single blank lines.
#>
function Get-ScriptHelpText([Parameter(Mandatory)][string]$Path) {
    $help = Get-Help $Path -Full
    $scriptName = "./$(Split-Path $Path -Leaf)"

    $sections = @(
        (Split-ToWidth "$scriptName - $($help.Synopsis.Trim())" (Get-HelpWidth)) -join "`n"
        Format-UsageSection $help $scriptName
        Format-TextSection 'Description' $help.description
        Format-ParametersSection $help
        Format-ExamplesSection $help
    ) | Where-Object { $_ }

    return ($sections -join "`n`n")
}

function Format-UsageSection($help, [string]$scriptName) {
    $width = Get-HelpWidth
    $lines = foreach ($syntaxItem in $help.syntax.syntaxItem) {
        $parameters = @($syntaxItem.parameter | Where-Object { $shouldProcessParameterNames -notcontains $_.name })
        if ($parameters.Count -eq 0) {
            continue
        }

        $tokens = @($scriptName) + @($syntaxItem.parameter | ForEach-Object { Format-SyntaxParameter $_ })
        Join-WrappedTokens $tokens $width
    }

    return "Usage:`n$($lines -join "`n")"
}

function Format-TextSection([string]$title, $textItems) {
    $text = ($textItems | ForEach-Object { $_.Text }) -join "`n`n"
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $null
    }

    return "${title}:`n$(Format-Wrapped $text '  ' ((Get-HelpWidth) - 2))"
}

function Format-ParametersSection($help) {
    $parameters = @($help.parameters.parameter | Where-Object { $shouldProcessParameterNames -notcontains $_.name })
    if ($parameters.Count -eq 0) {
        return $null
    }

    $labels = @($parameters | ForEach-Object { Format-ParameterLabel $_ })
    # Descriptions line up in one column, unless a label is so long that it would push them too far right
    $columnWidth = [Math]::Min(($labels | Measure-Object Length -Maximum).Maximum, $maxParameterLabelWidth) + 4
    $descriptionIndent = ' ' * $columnWidth
    $descriptionWidth = [Math]::Max((Get-HelpWidth) - $columnWidth, $minDescriptionWidth)

    $lines = for ($index = 0; $index -lt $parameters.Count; $index++) {
        $label = "  $($labels[$index])"
        $descriptionText = ($parameters[$index].description | ForEach-Object { $_.Text }) -join "`n"
        $description = Format-Wrapped $descriptionText $descriptionIndent $descriptionWidth
        if ($label.Length -lt $columnWidth) {
            $label.PadRight($columnWidth) + $description.Substring($columnWidth)
        }
        else {
            "$label`n$description"
        }
    }

    return "Parameters:`n$($lines -join "`n")"
}

function Format-ExamplesSection($help) {
    $examples = @($help.examples.example)
    if ($examples.Count -eq 0) {
        return $null
    }

    $lines = foreach ($example in $examples) {
        "  $($example.code.Trim())"
        $remarks = ($example.remarks | ForEach-Object { $_.Text }) -join "`n"
        if (![string]::IsNullOrWhiteSpace($remarks)) {
            Format-Wrapped $remarks '      ' ((Get-HelpWidth) - 6)
        }
    }

    return "Examples:`n$($lines -join "`n")"
}

function Format-SyntaxParameter($parameter) {
    $isSwitch = $parameter.parameterValue -eq 'SwitchParameter' -or !$parameter.parameterValue
    $name = "-$($parameter.name)"
    if ($parameter.position -ne 'named' -and $parameter.position) {
        $name = "[$name]"
    }

    $token = if ($isSwitch) {
        $name
    }
    else {
        "$name <$($parameter.parameterValue)>"
    }

    if ($parameter.required -eq 'true') {
        return $token
    }

    return "[$token]"
}

function Format-ParameterLabel($parameter) {
    $typeName = $parameter.type.name
    if (!$typeName -or $typeName -eq 'SwitchParameter') {
        return "-$($parameter.name)"
    }

    return "-$($parameter.name) <$typeName>"
}

function Join-WrappedTokens([string[]]$tokens, [int]$width) {
    $continuationIndent = '      '
    $lines = [System.Collections.Generic.List[string]]::new()
    $line = "  $($tokens[0])"
    foreach ($token in $tokens | Select-Object -Skip 1) {
        if ($line.Length + 1 + $token.Length -gt $width) {
            $lines.Add($line)
            $line = "$continuationIndent$token"
        }
        else {
            $line += " $token"
        }
    }

    $lines.Add($line)
    return $lines -join "`n"
}

function Format-Wrapped([string]$text, [string]$indent, [int]$width) {
    $paragraphs = $text.Trim() -split "(?:\r?\n){2,}" | Where-Object { $_.Trim() }

    $formattedParagraphs = foreach ($paragraph in $paragraphs) {
        $wrappedLines = foreach ($sentenceRun in Join-SourceLines $paragraph) {
            Split-ToWidth $sentenceRun $width
        }

        ($wrappedLines | ForEach-Object { "$indent$_" }) -join "`n"
    }

    return $formattedParagraphs -join "`n`n"
}

# The help source is hard-wrapped, so its lines are rejoined before wrapping to the console. A line that ends with a
# full stop is kept apart from the next one, since that's where the source breaks deliberately (e.g. 'Screenshot: ...'
# then 'Compare: ...', or 'e.g.' before an example on its own line), and rarely where it merely wraps.
function Join-SourceLines([string]$paragraph) {
    $runs = [System.Collections.Generic.List[string]]::new()
    foreach ($line in $paragraph -split "\r?\n") {
        $trimmedLine = $line.Trim()
        if ($runs.Count -gt 0 -and !$runs[$runs.Count - 1].EndsWith('.')) {
            $runs[$runs.Count - 1] += " $trimmedLine"
        }
        else {
            $runs.Add($trimmedLine)
        }
    }

    return $runs
}

function Split-ToWidth([string]$text, [int]$width) {
    $lines = [System.Collections.Generic.List[string]]::new()
    $line = ''
    foreach ($word in $text -split ' +') {
        if ($line -and $line.Length + 1 + $word.Length -gt $width) {
            $lines.Add($line)
            $line = $word
        }
        elseif ($line) {
            $line += " $word"
        }
        else {
            $line = $word
        }
    }

    $lines.Add($line)
    return $lines
}

function Get-HelpWidth {
    try {
        $consoleWidth = $Host.UI.RawUI.WindowSize.Width
    }
    catch {
        $consoleWidth = 0
    }

    if ($consoleWidth -gt 0) {
        return $consoleWidth - 1
    }

    return $defaultHelpWidth
}
