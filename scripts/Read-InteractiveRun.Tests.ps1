#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }

BeforeAll {
    . (Join-Path $PSScriptRoot 'Read-InteractiveRun.ps1')
    $script:policyId = 'ABCDEF1234567890ABCDEF1234567890'

    # Answers Read-InteractiveRun's questions in order (an empty string accepts the default), recording the settings
    # and clear-output listings it shows, and returns its commands as plain command lines
    function Invoke-ReadInteractiveRun([string[]]$answers, [string]$dotEnvPath = $script:dotEnvPath) {
        $script:answers = [System.Collections.Generic.Queue[string]]::new([string[]]$answers)
        $script:shown = [System.Collections.Generic.List[string]]::new()
        $steps = Read-InteractiveRun -DotEnvPath $dotEnvPath -ShowConfig {
            param($environment, $runName)

            $script:shown.Add("config $environment $runName")
        } -ShowClearOutput {
            param($environment, $runName)

            $script:shown.Add("clear $environment $runName")
        }

        $script:answers.Count | Should -Be 0 -Because 'every answer should be asked for'
        return @($steps | ForEach-Object { Format-InteractiveCommand $_ })
    }
}

Describe 'Read-InteractiveRun' {
    BeforeEach {
        Mock Read-Host { $script:answers.Dequeue() }

        Mock Write-Host {}

        $script:savedOutputDir = $env:OUTPUT_DIR
        $env:OUTPUT_DIR = $null
        $script:dotEnvPath = Join-Path $TestDrive "$([guid]::NewGuid()).env"
        Set-Content -LiteralPath $script:dotEnvPath -Value 'QUOTE_JOURNEY_ENVIRONMENT=dev'
    }

    AfterEach {
        $env:OUTPUT_DIR = $script:savedOutputDir
    }

    It 'runs the first 250 quote pages against .env''s environment, then summarises, when every default is taken' {
        # act (task, count, run name, environment, continue, clear, concurrency, no fetch, no OCR, summarise)
        $commands = Invoke-ReadInteractiveRun @('', '', '', '', '', '', '', '', '', '')

        # assert
        $commands | Should -Be @(
            './Run-Project.ps1 -QuotePages -MaxCount 250 -Environment dev'
            './Run-Project.ps1 -Summarise'
        )
        $script:shown | Should -Be @('config dev ', 'clear dev ')
    }

    It 'builds a named run on tst that clears first, with every option and no summary' {
        # act
        $commands = Invoke-ReadInteractiveRun @('1', '20', 'temp 2', '2', 'y', 'y', '5', 'y', 'y', 'n')

        # assert
        $commands | Should -Be @(
            "./Run-Project.ps1 -ClearOutput -Environment tst -RunName 'temp 2'"
            "./Run-Project.ps1 -QuotePages -MaxCount 20 -Environment tst -RunName 'temp 2' -Concurrency 5 -NoFetch -NoOcr"
        )
        $script:shown | Should -Be @('config tst temp 2', 'clear tst temp 2')
    }

    It 'runs a single policy when the count question is given a GUID' {
        # act
        $commands = Invoke-ReadInteractiveRun @('Quote pages', $script:policyId, '', '', '', '', '', '', '', 'n')

        # assert
        $commands | Should -Be @("./Run-Project.ps1 -QuotePages -Guid $script:policyId -Environment dev")
    }

    It 'asks One policy for its IDs, with history 1 by default, and no concurrency or fetch option' {
        # act (task, policy ID, history ID, run name, environment, continue, clear, no OCR, summarise)
        $commands = Invoke-ReadInteractiveRun @('4', $script:policyId, '', '', 'stg', '', '', 'y', '')

        # assert
        $commands | Should -Be @(
            "./Run-Project.ps1 -QuotePage -PolicyDetailsId $script:policyId -HistoryId 1 -Environment stg -NoOcr"
            './Run-Project.ps1 -Summarise'
        )
    }

    It 'offers no clearing for a retry, which needs the earlier results' {
        # act (task, run name, environment, continue, concurrency, no fetch, no OCR, summarise)
        $commands = Invoke-ReadInteractiveRun @('Retry failed', '', '', '', '', '', '', '')

        # assert
        $commands | Should -Be @('./Run-Project.ps1 -RetryFailed -Environment dev', './Run-Project.ps1 -Summarise')
        $script:shown | Should -Be @('config dev ')
    }

    It 'asks only for the run name for Summarise only, which uses .env''s environment' {
        # act (task, run name, continue)
        $commands = Invoke-ReadInteractiveRun @('5', 'temp2', '')

        # assert
        $commands | Should -Be @('./Run-Project.ps1 -Summarise -RunName temp2')
        $script:shown | Should -Be @('config  temp2')
    }

    It 'asks again for <Name>' -ForEach @(
        @{ Name = 'a run name that is not a valid folder name'; Answers = @('5', 'con', 'run.', 'temp2', ''); Expected = './Run-Project.ps1 -Summarise -RunName temp2' }

        @{ Name = 'a task that is not offered'; Answers = @('9', 'Deploy', 'summarise only', '', ''); Expected = './Run-Project.ps1 -Summarise' }

        @{ Name = 'a count that is not a number or GUID'; Answers = @('', '0', 'ten', '7', '', '', '', '', '', '', '', 'n'); Expected = './Run-Project.ps1 -QuotePages -MaxCount 7 -Environment dev' }
    ) {
        # act
        $commands = Invoke-ReadInteractiveRun $Answers

        # assert
        $commands | Should -Be @($Expected)
    }

    It 'defaults a named run to the environment its run.json records, and refuses another' {
        # arrange
        $outputDir = Join-Path $TestDrive ([guid]::NewGuid())
        New-Item -ItemType Directory (Join-Path $outputDir 'temp2') | Out-Null
        Set-Content -LiteralPath (Join-Path $outputDir 'temp2' 'run.json') -Value '{ "environment": "tst" }'
        Set-Content -LiteralPath $script:dotEnvPath -Value @('QUOTE_JOURNEY_ENVIRONMENT=dev', "OUTPUT_DIR=`"$outputDir`"")

        # act (task, run name, environment: dev is refused, then the default; continue, options, summarise)
        $commands = Invoke-ReadInteractiveRun @('Retry different', 'temp2', 'dev', '', '', '', '', '', 'n')

        # assert
        $commands | Should -Be @('./Run-Project.ps1 -RetryDifferent -Environment tst -RunName temp2')
        Should -Invoke Write-Host -ParameterFilter { "$Object" -like "*was made with tst*" } -Times 1 -Exactly
    }

    It 'returns nothing when the settings are not confirmed' {
        # act
        $commands = Invoke-ReadInteractiveRun @('', '', '', '', 'n')

        # assert
        $commands | Should -BeNullOrEmpty
    }
}

Describe 'Format-InteractiveCommand' {
    It 'quotes arguments with spaces, doubling any single quote' {
        # act
        $command = Format-InteractiveCommand @('-Summarise', '-RunName', "Bob's run")

        # assert
        $command | Should -Be "./Run-Project.ps1 -Summarise -RunName 'Bob''s run'"
    }
}

Describe 'Run-Project.ps1 -Interactive' {
    It 'refuses to start without a console to answer in' {
        # arrange
        $runProject = Join-Path $PSScriptRoot '..' 'Run-Project.ps1'

        # act
        $output = pwsh -NoProfile -NonInteractive -File $runProject -Interactive 2>&1 | Out-String

        # assert
        $LASTEXITCODE | Should -Be 1
        $output | Should -BeLike '*-Interactive needs a console*'
    }
}
