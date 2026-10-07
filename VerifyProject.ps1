#!/usr/bin/env pwsh
$commandList = @(
    "npx tsc",
    "npm run test",
    "pwsh -NoProfile -Command 'Import-Module Pester -MinimumVersion 5.0; Invoke-Pester ./scripts -CI'",
    "npm run lint"
)

$topLine = "#" * 50
foreach ($commandText in $commandList) {
    Write-Host "`n$topLine" -ForegroundColor Green
    Write-Host "# $commandText" -ForegroundColor Green
    Write-Host $topLine -ForegroundColor Green

    Invoke-Expression -Command $commandText
    if (!$? -Or $LASTEXITCODE -ne 0) {
        Write-Host "FAILED at: $commandText" -ForegroundColor Red
        Exit 1
    }
}

Write-Host "Done" -ForegroundColor Green
