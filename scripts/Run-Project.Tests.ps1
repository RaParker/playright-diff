#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }

BeforeAll {
    $script:runProject = Join-Path $PSScriptRoot '..' 'Run-Project.ps1' | Resolve-Path
    $script:projectRoot = Split-Path $script:runProject
    $script:cli = 'node node_modules/tsx/dist/cli.mjs src/main.ts'

    # Runs the wrapper in a child pwsh so its exit code and host output can be checked.
    function Invoke-RunProject([string[]]$arguments) {
        $output = pwsh -NoProfile -NonInteractive -File $script:runProject @arguments 2>&1 | Out-String
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

        @{ Name = 'npm task runs its npm script'; Arguments = @('-Task', 'TestQuotePage'); Expected = 'npm run test:quote-page' }

        @{ Name = 'Verify task runs VerifyProject.ps1'; Arguments = @('-Task', 'Verify'); Expected = '{root}\VerifyProject.ps1' }

        @{ Name = 'CleanUp task runs CleanUp.ps1'; Arguments = @('-Task', 'CleanUp'); Expected = '{root}\CleanUp.ps1' }
    ) {
        # arrange
        Push-Location $script:projectRoot
        $expectedCommand = $Expected.Replace('{cli}', $script:cli).Replace('{root}', $script:projectRoot)

        # act
        $result = Invoke-RunProject ($Arguments + '-WhatIf')
        Pop-Location

        # assert
        $result.ExitCode | Should -Be 0
        $result.Output | Should -BeLike "*on target `"$expectedCommand`"*"
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

        @{ Name = 'an unknown task'; Arguments = @('-Task', 'Deploy'); Message = "*parameter 'Task'*" }
    ) {
        # arrange
        Push-Location $script:projectRoot

        # act
        $result = Invoke-RunProject ($Arguments + '-WhatIf')
        Pop-Location

        # assert
        $result.ExitCode | Should -Not -Be 0
        $result.Output | Should -BeLike $Message
    }

    It 'shows help and succeeds when called with no arguments' {
        # arrange
        Push-Location $script:projectRoot

        # act
        $result = Invoke-RunProject @()
        Pop-Location

        # assert
        $result.ExitCode | Should -Be 0
        $result.Output | Should -BeLike '*SYNOPSIS*'
    }
}
