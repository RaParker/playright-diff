Push-Location $PSScriptRoot
Remove-Item ./comparisons/* -Force -Recurse
Remove-Item ./screenshots/* -Force -Recurse
Pop-Location
Write-Host "Done" -ForegroundColor Green
