#!/usr/bin/env pwsh
$commandList = @(
    "npm run typecheck",
    "npm run test",
    "pwsh -NoProfile -Command 'Import-Module Pester -MinimumVersion 5.0; Invoke-Pester ./scripts -CI'",
    "npm run lint"
)

$topLine = "#" * 50
# Run from the project folder, whichever folder the script is started from.
Push-Location $PSScriptRoot
try {
    foreach ($commandText in $commandList) {
        Write-Host "`n$topLine" -ForegroundColor Green
        Write-Host "# $commandText" -ForegroundColor Green
        Write-Host $topLine -ForegroundColor Green

        $global:LASTEXITCODE = 0
        Invoke-Expression -Command $commandText
        if (!$? -Or $LASTEXITCODE -ne 0) {
            Write-Host "FAILED at: $commandText" -ForegroundColor Red
            Exit 1
        }
    }
}
finally {
    Pop-Location
}

Write-Host "Done" -ForegroundColor Green
