# Clears the screenshots and comparisons folders in DIFF_OUTPUT_DIR (environment or .env), or in this project folder
# when it is not set.
Push-Location $PSScriptRoot
$outputDir = $env:DIFF_OUTPUT_DIR
if ([string]::IsNullOrWhiteSpace($outputDir) -and (Test-Path ./.env)) {
    $setting = Select-String -Path ./.env -Pattern '^\s*DIFF_OUTPUT_DIR\s*=\s*"?([^"]*)"?\s*$' | Select-Object -First 1
    if ($null -ne $setting) {
        $outputDir = $setting.Matches[0].Groups[1].Value
    }
}

if ([string]::IsNullOrWhiteSpace($outputDir)) {
    $outputDir = '.'
}

foreach ($folder in 'comparisons', 'screenshots') {
    $path = Join-Path $outputDir $folder
    if (Test-Path $path) {
        Remove-Item (Join-Path $path '*') -Force -Recurse
    }
}

Pop-Location
Write-Host "Done" -ForegroundColor Green
