#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }

BeforeAll {
    . (Join-Path $PSScriptRoot 'Get-ScriptHelpText.ps1')

    # A script with a help-only parameter set, ShouldProcess, a hard-wrapped description and examples with and without
    # remarks, i.e. everything Get-Help's own layout pads out
    $script:sampleScript = Join-Path $TestDrive 'Sample-Script.ps1'
    Set-Content -LiteralPath $script:sampleScript -Value @'
<#
.SYNOPSIS
Does a sample thing.

.DESCRIPTION
First line of the description,
which the source wraps here
Ends with a full stop.
A deliberate new line.

.PARAMETER Name
The name to use.

.PARAMETER Force
Overwrite anything already there.

.EXAMPLE
./Sample-Script.ps1 -Name a

Uses a.

.EXAMPLE
./Sample-Script.ps1 -Name b -Force
#>
[CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'Help')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Run')]
    [string]$Name,

    [Parameter(ParameterSetName = 'Run')]
    [switch]$Force
)

'@

    $script:helpText = Get-ScriptHelpText $script:sampleScript
    $script:helpLines = $script:helpText -split "`n"
}

Describe 'Get-ScriptHelpText' {
    It 'starts with the script name and synopsis' {
        # arrange
        $expected = './Sample-Script.ps1 - Does a sample thing.'

        # act
        $firstLine = $script:helpLines[0]

        # assert
        $firstLine | Should -Be $expected
    }

    It 'shows only the usage line that has parameters of its own' {
        # arrange
        $expected = @(
            'Usage:'
            '  ./Sample-Script.ps1 -Name <String> [-Force] [-WhatIf] [-Confirm]'
            ''
        ) -join "`n"

        # act
        $containsUsage = $script:helpText.Contains($expected)

        # assert
        $containsUsage | Should -BeTrue
    }

    It 'rejoins hard-wrapped lines but keeps the break after a full stop' {
        # arrange
        $expected = @(
            'Description:'
            '  First line of the description, which the source wraps here Ends with a full stop.'
            '  A deliberate new line.'
        ) -join "`n"

        # act
        $text = $script:helpText

        # assert
        $text | Should -BeLike "*$expected*"
    }

    It 'lines up parameter descriptions after their names' {
        # arrange
        $expected = @(
            'Parameters:'
            '  -Name <String>  The name to use.'
            '  -Force          Overwrite anything already there.'
        ) -join "`n"

        # act
        $text = $script:helpText

        # assert
        $text | Should -BeLike "*$expected*"
    }

    It 'lists examples on consecutive lines with their remarks indented' {
        # arrange
        $expected = @(
            'Examples:'
            '  ./Sample-Script.ps1 -Name a'
            '      Uses a.'
            '  ./Sample-Script.ps1 -Name b -Force'
        ) -join "`n"

        # act
        $text = $script:helpText

        # assert
        $text | Should -BeLike "*$expected"
    }

    It 'leaves out <Name>' -ForEach @(
        @{ Name = 'REMARKS'; Pattern = '*REMARKS*' }

        @{ Name = 'CommonParameters'; Pattern = '*CommonParameters*' }

        @{ Name = 'the WhatIf parameter description'; Pattern = "*`n  -WhatIf*" }

        @{ Name = 'the Confirm parameter description'; Pattern = "*`n  -Confirm*" }
    ) {
        # arrange
        $text = $script:helpText

        # act
        $matched = $text -like $Pattern

        # assert
        $matched | Should -BeFalse
    }

    It 'never leaves more than one blank line in a row' {
        # arrange
        $text = $script:helpText

        # act
        $hasBlankRun = $text -match "\n[ ]*\n[ ]*\n"

        # assert
        $hasBlankRun | Should -BeFalse
    }
}
