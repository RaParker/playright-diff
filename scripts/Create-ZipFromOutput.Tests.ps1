#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }

BeforeAll {
    $script:createZip = Join-Path $PSScriptRoot '..' 'Create-ZipFromOutput.ps1' | Resolve-Path
    $script:policyId = 'ABCDEF1234567890ABCDEF1234567890'

    # Runs the script in this session, so Read-Host can be mocked, and returns its host output and exit code
    function Invoke-CreateZip([hashtable]$arguments) {
        $global:LASTEXITCODE = 0
        $output = & $script:createZip @arguments 6>&1 | Out-String
        return [pscustomobject]@{ Output = $output; ExitCode = $LASTEXITCODE }
    }

    # Creates <root>/<policy-id>-<history-id>/ holding one file, and returns the folder
    function New-PolicyFolder([string]$root, [int]$historyId) {
        $folder = Join-Path $root "$script:policyId-$historyId"
        New-Item -ItemType Directory -Force -Path (Join-Path $folder 'api-mrp') | Out-Null
        Set-Content -LiteralPath (Join-Path $folder 'api-mrp' 'report.json') -Value '{}'
        return $folder
    }

    # Returns the entry names in a zip, with '/' separators
    function Get-ZipEntryNames([string]$zipPath) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
        try {
            return @($zip.Entries | ForEach-Object { $_.FullName -replace '\\', '/' })
        }
        finally {
            $zip.Dispose()
        }
    }
}

Describe 'Create-ZipFromOutput.ps1' {
    BeforeEach {
        $script:savedOutputDir = $env:OUTPUT_DIR
        $script:savedEnvironment = $env:QUOTE_JOURNEY_ENVIRONMENT
        $script:root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $script:noEnvFile = Join-Path $script:root 'missing.env'
        New-Item -ItemType Directory -Path $script:root | Out-Null
        $env:OUTPUT_DIR = $script:root
        $env:QUOTE_JOURNEY_ENVIRONMENT = $null
    }

    AfterEach {
        $env:OUTPUT_DIR = $script:savedOutputDir
        $env:QUOTE_JOURNEY_ENVIRONMENT = $script:savedEnvironment
    }

    It 'zips from the QUOTE_JOURNEY_ENVIRONMENT subfolder set in <Name>' -ForEach @(
        @{ Name = 'the .env file'; FromEnvironment = $false }

        @{ Name = 'the environment'; FromEnvironment = $true }
    ) {
        # arrange
        $environmentFolder = Join-Path $script:root 'tst'
        New-PolicyFolder $environmentFolder 1 | Out-Null
        $envFile = Join-Path $script:root '.env'
        if ($FromEnvironment) {
            $env:QUOTE_JOURNEY_ENVIRONMENT = 'TST'
            Set-Content -LiteralPath $envFile -Value 'QUOTE_JOURNEY_ENVIRONMENT=dev'
        }
        else {
            Set-Content -LiteralPath $envFile -Value 'QUOTE_JOURNEY_ENVIRONMENT=tst'
        }

        # act
        $result = Invoke-CreateZip @{ PolicyDetailsId = $script:policyId; EnvFile = $envFile }

        # assert
        $result.ExitCode | Should -Be 0
        Join-Path $environmentFolder "$script:policyId-1.zip" | Should -Exist
    }

    It 'zips history 1 when no HistoryId is given' {
        # arrange
        New-PolicyFolder $script:root 1 | Out-Null

        # act
        $result = Invoke-CreateZip @{ PolicyDetailsId = $script:policyId; EnvFile = $script:noEnvFile }

        # assert
        $result.ExitCode | Should -Be 0
        $zipPath = Join-Path $script:root "$script:policyId-1.zip"
        Get-ZipEntryNames $zipPath | Should -Contain "$script:policyId-1/api-mrp/report.json"
    }

    It 'zips the given HistoryId' {
        # arrange
        New-PolicyFolder $script:root 3 | Out-Null

        # act
        $result = Invoke-CreateZip @{ PolicyDetailsId = $script:policyId; HistoryId = '3'; EnvFile = $script:noEnvFile }

        # assert
        $result.ExitCode | Should -Be 0
        Join-Path $script:root "$script:policyId-3.zip" | Should -Exist
    }

    It 'writes the zip to Destination' {
        # arrange
        New-PolicyFolder $script:root 1 | Out-Null
        $destination = Join-Path $script:root 'zips'

        # act
        $result = Invoke-CreateZip @{ PolicyDetailsId = $script:policyId; Destination = $destination; EnvFile = $script:noEnvFile }

        # assert
        $result.ExitCode | Should -Be 0
        Join-Path $destination "$script:policyId-1.zip" | Should -Exist
    }

    It 'refuses a Destination that is <Name>' -ForEach @(
        @{ Name = 'the project itself'; Folder = '.' }

        @{ Name = 'inside the project'; Folder = 'zips-test-output' }
    ) {
        # arrange
        New-PolicyFolder $script:root 1 | Out-Null
        $project = Split-Path $script:createZip -Parent
        $destination = Join-Path $project $Folder

        # act
        $result = Invoke-CreateZip @{ PolicyDetailsId = $script:policyId; Destination = $destination; EnvFile = $script:noEnvFile }

        # assert
        $result.ExitCode | Should -Be 1
        $result.Output | Should -Match 'is inside this project'
        Join-Path $destination "$script:policyId-1.zip" | Should -Not -Exist
        Join-Path $project 'zips-test-output' | Should -Not -Exist
    }

    It 'reads OUTPUT_DIR from the .env file, with <Name>' -ForEach @(
        @{ Name = 'double quotes'; Format = 'OUTPUT_DIR="{0}"' }

        @{ Name = 'single quotes'; Format = "OUTPUT_DIR='{0}'" }

        @{ Name = 'no quotes and a comment'; Format = 'OUTPUT_DIR={0} # output' }
    ) {
        # arrange
        $env:OUTPUT_DIR = $null
        $outputDir = Join-Path $script:root 'from-env-file'
        New-PolicyFolder $outputDir 1 | Out-Null
        $envFile = Join-Path $script:root '.env'
        Set-Content -LiteralPath $envFile -Value @('# settings', 'OTHER=1', ($Format -f $outputDir))

        # act
        $result = Invoke-CreateZip @{ PolicyDetailsId = $script:policyId; EnvFile = $envFile }

        # assert
        $result.ExitCode | Should -Be 0
        Join-Path $outputDir "$script:policyId-1.zip" | Should -Exist
    }

    It 'prefers the .env OUTPUT_DIR to the environment variable, which mrp-and-quote also reads' {
        # arrange
        $outputDir = Join-Path $script:root 'from-env-file'
        New-PolicyFolder $outputDir 1 | Out-Null
        $envFile = Join-Path $script:root '.env'
        Set-Content -LiteralPath $envFile -Value "OUTPUT_DIR=$outputDir"

        # act
        $result = Invoke-CreateZip @{ PolicyDetailsId = $script:policyId; EnvFile = $envFile }

        # assert
        $result.ExitCode | Should -Be 0
        Join-Path $outputDir "$script:policyId-1.zip" | Should -Exist
        Join-Path $script:root "$script:policyId-1.zip" | Should -Not -Exist
    }

    It 'refuses an output folder inside the project, saying to set OUTPUT_DIR' {
        # arrange
        $env:OUTPUT_DIR = Split-Path $script:createZip -Parent

        # act
        $result = Invoke-CreateZip @{ PolicyDetailsId = $script:policyId; EnvFile = $script:noEnvFile }

        # assert
        $result.ExitCode | Should -Be 1
        $result.Output | Should -Match 'The output folder .+ is inside this project .+ Set OUTPUT_DIR in \.env'
    }

    It 'fails when the policy folder does not exist' {
        # act
        $result = Invoke-CreateZip @{ PolicyDetailsId = $script:policyId; EnvFile = $script:noEnvFile }

        # assert
        $result.ExitCode | Should -Be 1
        $result.Output | Should -Match 'No output folder'
    }

    It 'rejects <Name>' -ForEach @(
        @{ Name = 'a PolicyDetailsId that is not 32 hex characters'; Arguments = @{ PolicyDetailsId = 'not-a-guid' }; Message = 'PolicyDetailsId must be' }

        @{ Name = 'a negative HistoryId'; Arguments = @{ PolicyDetailsId = 'ABCDEF1234567890ABCDEF1234567890'; HistoryId = '-1' }; Message = 'HistoryId must be' }
    ) {
        # act
        $result = Invoke-CreateZip $Arguments

        # assert
        $result.ExitCode | Should -Be 1
        $result.Output | Should -Match $Message
    }

    Context 'when the zip already exists' {
        BeforeEach {
            New-PolicyFolder $script:root 1 | Out-Null
            $script:zipPath = Join-Path $script:root "$script:policyId-1.zip"
            Set-Content -LiteralPath $script:zipPath -Value 'old zip'
        }

        It 'replaces it when the answer is <Answer>' -ForEach @(
            @{ Answer = 'y' }

            @{ Answer = 'Yes' }
        ) {
            # arrange
            Mock Read-Host { $Answer }

            # act
            $result = Invoke-CreateZip @{ PolicyDetailsId = $script:policyId; EnvFile = $script:noEnvFile }

            # assert
            $result.ExitCode | Should -Be 0
            Should -Invoke Read-Host -Times 1 -Exactly
            Get-ZipEntryNames $script:zipPath | Should -Contain "$script:policyId-1/api-mrp/report.json"
        }

        It 'keeps it when the answer is <Name>' -ForEach @(
            @{ Name = 'n'; Answer = 'n' }

            @{ Name = 'empty'; Answer = '' }
        ) {
            # arrange
            Mock Read-Host { $Answer }

            # act
            $result = Invoke-CreateZip @{ PolicyDetailsId = $script:policyId; EnvFile = $script:noEnvFile }

            # assert
            $result.ExitCode | Should -Be 0
            $result.Output | Should -Match 'Not replaced'
            Get-Content -LiteralPath $script:zipPath | Should -Be 'old zip'
        }

        It 'replaces it without asking when Force is given' {
            # arrange
            Mock Read-Host { 'n' }

            # act
            $result = Invoke-CreateZip @{ PolicyDetailsId = $script:policyId; Force = $true; EnvFile = $script:noEnvFile }

            # assert
            $result.ExitCode | Should -Be 0
            Should -Invoke Read-Host -Times 0 -Exactly
            Get-ZipEntryNames $script:zipPath | Should -Contain "$script:policyId-1/api-mrp/report.json"
        }
    }
}
