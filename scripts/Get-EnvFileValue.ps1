<#
.SYNOPSIS
Reads one setting from a .env file, without expanding ${NAME} references.

.DESCRIPTION
Dot-source this file, then call Get-EnvFileValue. Shared by Create-ZipFromOutput.ps1 and Run-Project.ps1 -Interactive.
#>

#Requires -Version 7.4
Set-StrictMode -Version Latest                   # error on undefined variables, missing properties, bad indexing
$ErrorActionPreference = 'Stop'                  # non-terminating errors become terminating
$PSNativeCommandUseErrorActionPreference = $true # non-zero exit codes from native commands (git, kubectl, go…) throw

# Returns the value of the name=... line in the .env file at the path, or $null when the file or the line is missing
function Get-EnvFileValue([string]$Path, [string]$Name) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }

    # Matches NAME=value, NAME="value" or NAME='value', with optional "export " and a trailing # comment
    $pattern = "^\s*(?:export\s+)?$([regex]::Escape($Name))\s*=\s*(?:`"([^`"]*)`"|'([^']*)'|([^#]*?))\s*(?:#.*)?$"
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match $pattern) {
            return @($Matches[1], $Matches[2], $Matches[3]) | Where-Object { $_ } | Select-Object -First 1
        }
    }

    return $null
}
