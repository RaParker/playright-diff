#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
#Requires -Version 7.4
Set-StrictMode -Version Latest                   # error on undefined variables, missing properties, bad indexing
$ErrorActionPreference = 'Stop'                  # non-terminating errors become terminating
$PSNativeCommandUseErrorActionPreference = $true # non-zero exit codes from native commands (git, kubectl, go…) throw

BeforeAll {
    $script:runProject = Join-Path $PSScriptRoot '..' 'Run-Project.ps1' | Resolve-Path
    $script:projectRoot = Split-Path $script:runProject
    $script:cli = 'node node_modules/tsx/dist/cli.mjs src/main.ts'

    # Runs the wrapper in a child pwsh from the project folder, so its exit code and host output can be checked. The
    # folder is restored even when the run throws, so one failing test cannot change the folder the next one runs in.
    function Invoke-RunProject([string[]]$arguments) {
        Push-Location $script:projectRoot
        try {
            # Tests check the exit code themselves, so a failing run must not throw
            $PSNativeCommandUseErrorActionPreference = $false
            $output = pwsh -NoProfile -NonInteractive -File $script:runProject @arguments 2>&1 | Out-String
            return [pscustomobject]@{ Output = $output; ExitCode = $LASTEXITCODE }
        }
        finally {
            Pop-Location
        }
    }

    # Writes the -Environment tests' .env beside the copied wrapper: the environment line it rewrites, among lines it keeps
    function Set-TestDotEnv([string]$environment, [string]$quoteJourneyHost = 'quotes-${QUOTE_JOURNEY_ENVIRONMENT}.homeprotect.co.uk', [string]$newline = "`n") {
        $lines = @(
            'OUTPUT_DIR="D:/temp/output"'
            "QUOTE_JOURNEY_ENVIRONMENT=$environment"
            "QUOTE_JOURNEY_HOST=$quoteJourneyHost"
            'QUOTE_JOURNEY_QUOTE_GUID_URL="https://${QUOTE_JOURNEY_HOST}/api/nhi/quote-guid"'
        )
        [System.IO.File]::WriteAllText($script:dotEnvPath, ($lines -join $newline) + $newline)
    }

    # Runs the copied wrapper, which reads and writes its own .env rather than the project's
    function Invoke-CopiedRunProject([string[]]$arguments) {
        # Tests check the exit code themselves, so a failing run must not throw
        $PSNativeCommandUseErrorActionPreference = $false
        $output = pwsh -NoProfile -NonInteractive -File $script:copiedScript @arguments 2>&1 | Out-String
        return [pscustomobject]@{ Output = $output; ExitCode = $LASTEXITCODE }
    }
}

Describe 'Run-Project.ps1 command lines' {
    It '<Name>' -ForEach @(
        @{ Name = 'screenshot forwards only the options given'; Arguments = @('-Screenshot', '-Url', 'https://example.com/?a=1&b=2', '-Width', '390', '-Timeout', '5000'); Expected = '{cli} screenshot https://example.com/?a=1&b=2 --timeout 5000 --width 390' }

        @{ Name = 'screenshot resolves a relative output path'; Arguments = @('-Screenshot', '-Url', 'https://example.com', '-Output', 'screenshots/x.png'); Expected = '{cli} screenshot https://example.com --output {root}\screenshots\x.png' }

        @{ Name = 'compare passes images, threshold, language and no-ocr'; Arguments = @('-Compare', '-Before', 'README.md', '-After', 'LICENSE', '-Threshold', '0', '-Language', 'eng+fra', '-NoOcr'); Expected = '{cli} compare {root}\README.md {root}\LICENSE --language eng+fra --threshold 0 --no-ocr' }

        @{ Name = 'quote-page passes the policy and history IDs'; Arguments = @('-QuotePage', '-PolicyDetailsId', 'ABCDEF1234567890ABCDEF1234567890', '-HistoryId', '42'); Expected = '{cli} quote-page ABCDEF1234567890ABCDEF1234567890 42' }

        @{ Name = 'quote-pages with no selector runs the default count'; Arguments = @('-QuotePages'); Expected = '{cli} quote-pages' }

        @{ Name = 'quote-pages passes MaxCount'; Arguments = @('-QuotePages', '-MaxCount', '10', '-NoOcr'); Expected = '{cli} quote-pages 10 --no-ocr' }

        @{ Name = 'quote-pages passes a single GUID'; Arguments = @('-QuotePages', '-Guid', '6819e30c2058490b8d1d9e25d267b002'); Expected = '{cli} quote-pages 6819e30c2058490b8d1d9e25d267b002' }

        @{ Name = 'retry-failed reruns saved failures'; Arguments = @('-RetryFailed'); Expected = '{cli} quote-pages retry-failed' }

        @{ Name = 'retry-different reruns different policies'; Arguments = @('-RetryDifferent', '-NoOcr'); Expected = '{cli} quote-pages retry-different --no-ocr' }

        @{ Name = 'quote-pages passes Concurrency'; Arguments = @('-QuotePages', '-MaxCount', '1300', '-Concurrency', '5', '-NoOcr'); Expected = '{cli} quote-pages 1300 --concurrency 5 --no-ocr' }

        @{ Name = 'retry-failed passes Concurrency'; Arguments = @('-RetryFailed', '-Concurrency', '1'); Expected = '{cli} quote-pages retry-failed --concurrency 1' }

        @{ Name = 'retry-different passes Concurrency'; Arguments = @('-RetryDifferent', '-Concurrency', '2'); Expected = '{cli} quote-pages retry-different --concurrency 2' }

        @{ Name = 'quote-pages passes NoFetch'; Arguments = @('-QuotePages', '-MaxCount', '20000', '-NoFetch'); Expected = '{cli} quote-pages 20000 --no-fetch' }

        @{ Name = 'retry-failed passes NoFetch after Concurrency'; Arguments = @('-RetryFailed', '-NoFetch', '-Concurrency', '4'); Expected = '{cli} quote-pages retry-failed --concurrency 4 --no-fetch' }

        @{ Name = 'summarise runs the summary'; Arguments = @('-Summarise'); Expected = '{cli} summarise' }

        @{ Name = 'summarize is an alias for summarise'; Arguments = @('-Summarize'); Expected = '{cli} summarise' }

        @{ Name = 'summarise passes the differences mode'; Arguments = @('-Summarise', '-Mode', 'differences'); Expected = '{cli} summarise differences' }

        @{ Name = 'summarise passes the changed-answers mode'; Arguments = @('-Summarise', '-Mode', 'changed-answers'); Expected = '{cli} summarise changed-answers' }

        @{ Name = 'migrate-output lists what would move'; Arguments = @('-MigrateOutput'); Expected = '{cli} migrate-output' }

        @{ Name = 'migrate-output resolves Root and passes Apply'; Arguments = @('-MigrateOutput', '-Root', 'scripts', '-Apply'); Expected = '{cli} migrate-output --root {root}\scripts --apply' }

        @{ Name = 'npm task runs its npm script'; Arguments = @('-Task', 'TestQuotePage'); Expected = 'npm run test:quote-page' }

        @{ Name = 'Verify task runs VerifyProject.ps1'; Arguments = @('-Task', 'Verify'); Expected = '{root}\VerifyProject.ps1' }
    ) {
        # arrange
        $expectedCommand = $Expected.Replace('{cli}', $script:cli).Replace('{root}', $script:projectRoot)

        # act
        $result = Invoke-RunProject ($Arguments + '-WhatIf')

        # assert
        $result.ExitCode | Should -Be 0
        # A plain substring check: -BeLike would read the ? and [ in URLs and paths as wildcards.
        $result.Output.Contains("on target `"$expectedCommand`"") | Should -BeTrue -Because $result.Output
    }
}

Describe 'Run-Project.ps1 -ClearOutput -WhatIf' {
    BeforeEach {
        # The project's .env decides OUTPUT_DIR over the environment, so the wrapper runs from a copy with its own .env
        # pointing at a temporary output folder; junctions to node_modules and src let the copy run the real CLI.
        $script:savedOutputDir = $env:OUTPUT_DIR
        $script:savedEnvironment = $env:QUOTE_JOURNEY_ENVIRONMENT
        $env:OUTPUT_DIR = $null
        $env:QUOTE_JOURNEY_ENVIRONMENT = $null
        $script:outputRoot = Join-Path $TestDrive ([guid]::NewGuid())
        foreach ($folder in 'dev', 'stg', 'temp2') {
            New-Item -ItemType Directory (Join-Path $script:outputRoot $folder 'ABCDEF1234567890ABCDEF1234567890-1') | Out-Null
        }

        $script:copyRoot = Join-Path $TestDrive ([guid]::NewGuid())
        New-Item -ItemType Directory $script:copyRoot | Out-Null
        $script:copiedScript = Join-Path $script:copyRoot 'Run-Project.ps1'
        Copy-Item $script:runProject $script:copiedScript
        foreach ($file in 'package.json', 'tsconfig.json') {
            Copy-Item (Join-Path $script:projectRoot $file) $script:copyRoot
        }

        foreach ($folder in 'node_modules', 'src') {
            New-Item -ItemType Junction -Path (Join-Path $script:copyRoot $folder) -Target (Join-Path $script:projectRoot $folder) | Out-Null
        }

        $dotEnv = @(
            "OUTPUT_DIR=`"$($script:outputRoot -replace '\\', '/')`""
            'QUOTE_JOURNEY_ENVIRONMENT=dev'
            'QUOTE_JOURNEY_HOST=quotes-${QUOTE_JOURNEY_ENVIRONMENT}.homeprotect.co.uk'
        ) -join "`n"
        [System.IO.File]::WriteAllText((Join-Path $script:copyRoot '.env'), "$dotEnv`n")
    }

    AfterEach {
        # Remove the junctions first, so deleting the copy never reaches into the real folders
        foreach ($folder in 'node_modules', 'src') {
            [System.IO.Directory]::Delete((Join-Path $script:copyRoot $folder))
        }

        $env:OUTPUT_DIR = $script:savedOutputDir
        $env:QUOTE_JOURNEY_ENVIRONMENT = $script:savedEnvironment
    }

    It 'lists the <Expected> folder it would delete, deleting nothing' -ForEach @(
        @{ Arguments = @('-ClearOutput', '-WhatIf'); Expected = 'dev' }

        @{ Arguments = @('-ClearOutput', '-Environment', 'stg', '-WhatIf'); Expected = 'stg' }

        @{ Arguments = @('-ClearOutput', '-RunName', 'temp2', '-WhatIf'); Expected = 'temp2' }
    ) {
        # arrange
        $expectedFolder = Join-Path $script:outputRoot $Expected

        # act
        $result = Invoke-CopiedRunProject $Arguments

        # assert
        $result.ExitCode | Should -Be 0 -Because $result.Output
        $result.Output.Contains("$script:cli clear-output --dry-run") | Should -BeTrue -Because $result.Output
        $result.Output.Contains("Would delete these folders:") | Should -BeTrue -Because $result.Output
        $result.Output.Contains("  $expectedFolder (1 entry)") | Should -BeTrue -Because $result.Output
        $result.Output | Should -BeLike '*Dry run: nothing was deleted.*'
        Join-Path $script:outputRoot 'dev' | Should -Exist
        Join-Path $script:outputRoot 'stg' | Should -Exist
        Join-Path $script:outputRoot 'temp2' | Should -Exist
    }
}

Describe 'Run-Project.ps1 validation' {
    It 'rejects <Name>' -ForEach @(
        @{ Name = 'a non-http URL'; Arguments = @('-Screenshot', '-Url', 'example.com'); Message = "*parameter 'Url'*" }

        @{ Name = 'a missing before image'; Arguments = @('-Compare', '-Before', 'missing.png', '-After', 'LICENSE'); Message = '*Before image "missing.png" does not exist*' }

        @{ Name = 'a threshold above 255'; Arguments = @('-Compare', '-Before', 'README.md', '-After', 'LICENSE', '-Threshold', '256'); Message = "*parameter 'Threshold'*" }

        @{ Name = 'a policy ID that is not 32 hex characters'; Arguments = @('-QuotePage', '-PolicyDetailsId', 'ABC-123', '-HistoryId', '1'); Message = "*parameter 'PolicyDetailsId'*" }

        @{ Name = 'a negative history ID'; Arguments = @('-QuotePage', '-PolicyDetailsId', 'ABCDEF1234567890ABCDEF1234567890', '-HistoryId', '-1'); Message = "*parameter 'HistoryId'*" }

        @{ Name = 'a MaxCount of zero'; Arguments = @('-QuotePages', '-MaxCount', '0'); Message = "*parameter 'MaxCount'*" }

        @{ Name = 'MaxCount together with Guid'; Arguments = @('-QuotePages', '-MaxCount', '3', '-Guid', '6819e30c2058490b8d1d9e25d267b002'); Message = '*Parameter set cannot be resolved*' }

        @{ Name = 'an option from another command'; Arguments = @('-QuotePage', '-PolicyDetailsId', 'ABCDEF1234567890ABCDEF1234567890', '-HistoryId', '1', '-Threshold', '5'); Message = '*Parameter set cannot be resolved*' }

        @{ Name = 'NoOcr with Summarise'; Arguments = @('-Summarise', '-NoOcr'); Message = '*Parameter set cannot be resolved*' }

        @{ Name = 'NoFetch with QuotePage'; Arguments = @('-QuotePage', '-PolicyDetailsId', 'ABCDEF1234567890ABCDEF1234567890', '-HistoryId', '1', '-NoFetch'); Message = '*Parameter set cannot be resolved*' }

        @{ Name = 'a Concurrency of zero'; Arguments = @('-QuotePages', '-Concurrency', '0'); Message = "*parameter 'Concurrency'*" }

        @{ Name = 'Concurrency with QuotePage'; Arguments = @('-QuotePage', '-PolicyDetailsId', 'ABCDEF1234567890ABCDEF1234567890', '-HistoryId', '1', '-Concurrency', '2'); Message = '*Parameter set cannot be resolved*' }

        @{ Name = 'an unknown task'; Arguments = @('-Task', 'Deploy'); Message = "*parameter 'Task'*" }

        @{ Name = 'an unknown summarise mode'; Arguments = @('-Summarise', '-Mode', 'everything'); Message = "*parameter 'Mode'*" }

        @{ Name = 'a missing migrate-output Root'; Arguments = @('-MigrateOutput', '-Root', 'missing-folder'); Message = '*Output folder "missing-folder" does not exist*' }

        @{ Name = 'Apply without MigrateOutput'; Arguments = @('-Summarise', '-Apply'); Message = '*Parameter set cannot be resolved*' }

        @{ Name = 'ClearOutput with another command option'; Arguments = @('-ClearOutput', '-Root', 'scripts'); Message = '*Parameter set cannot be resolved*' }

        @{ Name = 'Mode without Summarise'; Arguments = @('-RetryFailed', '-Mode', 'differences'); Message = '*Parameter set cannot be resolved*' }

        @{ Name = 'an unknown environment'; Arguments = @('-QuotePages', '-Environment', 'liv'); Message = "*parameter 'Environment'*" }

        @{ Name = 'Environment with Summarise'; Arguments = @('-Summarise', '-Environment', 'tst'); Message = '*Parameter set cannot be resolved*' }
    ) {
        # arrange
        $arguments = $Arguments + '-WhatIf'

        # act
        $result = Invoke-RunProject $arguments

        # assert
        $result.ExitCode | Should -Not -Be 0
        $result.Output | Should -BeLike $Message
    }

    It 'shows the overview sections in order and succeeds when called with no arguments' {
        # arrange
        $arguments = @()

        # act
        $result = Invoke-RunProject $arguments

        # assert
        $result.ExitCode | Should -Be 0
        $result.Output | Should -BeLike '*./Run-Project.ps1 - *1. Set up*2. Compare NHI and TCAS*3. Single runs*4. Development*'
    }

    It 'lists every parameter and task in the overview' {
        # arrange
        $commonParameterNames = [System.Management.Automation.PSCmdlet]::CommonParameters +
        [System.Management.Automation.PSCmdlet]::OptionalCommonParameters
        $parameters = (Get-Command $script:runProject).Parameters.Values |
            Where-Object { $commonParameterNames -notcontains $_.Name }

        $taskNames = $parameters.Where({ $_.Name -eq 'Task' }).Attributes.ValidValues

        # act
        $result = Invoke-RunProject @()

        # assert
        $missingParameters = @($parameters.Name | Where-Object { $result.Output -notmatch "-$_\b" })
        $missingTasks = @($taskNames | Where-Object { $result.Output -notmatch "\b$_\b" })
        $missingParameters | Should -BeNullOrEmpty
        $missingTasks | Should -BeNullOrEmpty
    }
}

Describe 'Run-Project.ps1 -Environment' {
    BeforeEach {
        # A copy of the wrapper beside its own .env, so the project's .env is never touched. The copy has no
        # node_modules, so a run that gets past the .env change fails at node; only -WhatIf runs exit 0.
        $script:copyRoot = Join-Path $TestDrive ([guid]::NewGuid())
        New-Item -ItemType Directory $script:copyRoot | Out-Null
        $script:copiedScript = Join-Path $script:copyRoot 'Run-Project.ps1'
        Copy-Item $script:runProject $script:copiedScript
        $script:dotEnvPath = Join-Path $script:copyRoot '.env'
    }

    It 'switches .env to <Environment>, changing only its environment line' -ForEach @(
        @{ Environment = 'tst'; Arguments = @('-QuotePages', '-Environment', 'tst'); ExpectedHost = 'quotes-tst.homeprotect.co.uk' }

        @{ Environment = 'stg'; Arguments = @('-RetryFailed', '-Environment', 'stg'); ExpectedHost = 'quotes-stg.homeprotect.co.uk' }

        @{ Environment = 'dev'; Arguments = @('-QuotePage', '-PolicyDetailsId', 'ABCDEF1234567890ABCDEF1234567890', '-HistoryId', '1'); ExpectedHost = 'quotes-dev.homeprotect.co.uk' }
    ) {
        # arrange
        $startEnvironment = if ($Environment -eq 'dev') {
            'tst'
        }
        else {
            'dev'
        }

        Set-TestDotEnv $startEnvironment

        # act
        $result = Invoke-CopiedRunProject $Arguments

        # assert
        $result.Output | Should -BeLike "*Environment: $Environment ($ExpectedHost)*"
        $result.Output | Should -BeLike "*Switched .env to $Environment.*"
        [System.IO.File]::ReadAllText($script:dotEnvPath) | Should -BeExactly (
            "OUTPUT_DIR=`"D:/temp/output`"`nQUOTE_JOURNEY_ENVIRONMENT=$Environment`n" +
            "QUOTE_JOURNEY_HOST=quotes-`${QUOTE_JOURNEY_ENVIRONMENT}.homeprotect.co.uk`n" +
            "QUOTE_JOURNEY_QUOTE_GUID_URL=`"https://`${QUOTE_JOURNEY_HOST}/api/nhi/quote-guid`"`n")
    }

    It 'keeps CRLF line endings when switching' {
        # arrange
        Set-TestDotEnv 'dev' -newline "`r`n"

        # act
        Invoke-CopiedRunProject @('-RetryDifferent', '-Environment', 'tst') | Out-Null

        # assert
        $text = [System.IO.File]::ReadAllText($script:dotEnvPath)
        $text | Should -BeLike "*`r`nQUOTE_JOURNEY_ENVIRONMENT=tst`r`n*"
        ($text -replace "`r`n", '') | Should -Not -Match "[`r`n]"
    }

    It 'leaves .env unwritten when it is already on the environment' {
        # arrange
        Set-TestDotEnv 'tst' 'quotes-feature-${QUOTE_JOURNEY_ENVIRONMENT}.homeprotect.co.uk'
        $lastWrite = (Get-Item $script:dotEnvPath).LastWriteTimeUtc.AddDays(-1)
        (Get-Item $script:dotEnvPath).LastWriteTimeUtc = $lastWrite

        # act
        $result = Invoke-CopiedRunProject @('-QuotePages', '-Environment', 'tst', '-WhatIf')

        # assert
        $result.ExitCode | Should -Be 0
        $result.Output | Should -BeLike '*Environment: tst (quotes-feature-tst.homeprotect.co.uk)*'
        $result.Output | Should -Not -BeLike '*QUOTE_JOURNEY_ENVIRONMENT=*'
        (Get-Item $script:dotEnvPath).LastWriteTimeUtc | Should -Be $lastWrite
    }

    It 'only reports the .env change with -WhatIf, defaulting to dev' {
        # arrange
        Set-TestDotEnv 'stg'
        $before = [System.IO.File]::ReadAllText($script:dotEnvPath)

        # act
        $result = Invoke-CopiedRunProject @('-QuotePages', '-WhatIf')

        # assert
        $result.ExitCode | Should -Be 0
        $result.Output | Should -BeLike '*Environment: dev (quotes-dev.homeprotect.co.uk)*'
        $result.Output | Should -BeLike '*What if:*Set QUOTE_JOURNEY_ENVIRONMENT=dev*'
        [System.IO.File]::ReadAllText($script:dotEnvPath) | Should -BeExactly $before
    }

    It 'fails without running the command when .env has no QUOTE_JOURNEY_HOST line' {
        # arrange
        [System.IO.File]::WriteAllText($script:dotEnvPath, "QUOTE_JOURNEY_ENVIRONMENT=dev`n")

        # act
        $result = Invoke-CopiedRunProject @('-QuotePages', '-Environment', 'tst', '-WhatIf')

        # assert
        $result.ExitCode | Should -Not -Be 0
        $result.Output | Should -BeLike '*.env has no QUOTE_JOURNEY_HOST line*'
        [System.IO.File]::ReadAllText($script:dotEnvPath) | Should -BeExactly "QUOTE_JOURNEY_ENVIRONMENT=dev`n"
    }

    It 'refuses a feature host for stg, as feature builds only reach dev and tst' {
        # arrange
        Set-TestDotEnv 'dev' 'quotes-feature-${QUOTE_JOURNEY_ENVIRONMENT}.homeprotect.co.uk'
        $before = [System.IO.File]::ReadAllText($script:dotEnvPath)

        # act
        $result = Invoke-CopiedRunProject @('-QuotePages', '-Environment', 'stg', '-WhatIf')

        # assert
        $result.ExitCode | Should -Not -Be 0
        $result.Output | Should -BeLike '*feature builds only reach dev and tst*'
        [System.IO.File]::ReadAllText($script:dotEnvPath) | Should -BeExactly $before
    }

    It 'fails without running the command when QUOTE_JOURNEY_HOST does not refer to the environment' {
        # arrange
        Set-TestDotEnv 'dev' 'quotes-dev.homeprotect.co.uk'
        $before = [System.IO.File]::ReadAllText($script:dotEnvPath)

        # act
        $result = Invoke-CopiedRunProject @('-QuotePages', '-Environment', 'tst', '-WhatIf')

        # assert
        $result.ExitCode | Should -Not -Be 0
        $result.Output | Should -BeLike '*does not refer to ${QUOTE_JOURNEY_ENVIRONMENT}*'
        [System.IO.File]::ReadAllText($script:dotEnvPath) | Should -BeExactly $before
    }

    It 'switches .env for -ClearOutput only when -Environment is given' {
        # arrange
        Set-TestDotEnv 'dev'
        $before = [System.IO.File]::ReadAllText($script:dotEnvPath)

        # act (-WhatIf runs the dry run, which fails at node in the copy; only the .env handling is checked here)
        $without = Invoke-CopiedRunProject @('-ClearOutput', '-WhatIf')
        $with = Invoke-CopiedRunProject @('-ClearOutput', '-Environment', 'stg', '-WhatIf')

        # assert
        $without.Output | Should -Not -BeLike '*Environment:*'
        $with.Output | Should -BeLike '*What if:*Set QUOTE_JOURNEY_ENVIRONMENT=stg*'
        [System.IO.File]::ReadAllText($script:dotEnvPath) | Should -BeExactly $before
    }

    It 'leaves .env alone for commands without -Environment' {
        # arrange
        Set-TestDotEnv 'tst'
        $before = [System.IO.File]::ReadAllText($script:dotEnvPath)

        # act
        $result = Invoke-CopiedRunProject @('-Summarise', '-WhatIf')

        # assert
        $result.ExitCode | Should -Be 0
        $result.Output | Should -Not -BeLike '*Environment:*'
        [System.IO.File]::ReadAllText($script:dotEnvPath) | Should -BeExactly $before
    }

    It 'runs show-config for -ShowConfig -Environment without writing .env, even with -WhatIf' {
        # arrange
        Set-TestDotEnv 'dev'
        $before = [System.IO.File]::ReadAllText($script:dotEnvPath)

        # act (the command itself fails at node in the copy; only that it runs, and .env, are checked here)
        $result = Invoke-CopiedRunProject @('-ShowConfig', '-Environment', 'tst', '-WhatIf')

        # assert
        $result.Output | Should -BeLike '*src/main.ts show-config*'
        $result.Output | Should -Not -BeLike '*What if:*'
        [System.IO.File]::ReadAllText($script:dotEnvPath) | Should -BeExactly $before
    }
}
