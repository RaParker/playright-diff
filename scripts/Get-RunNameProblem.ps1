<#
.SYNOPSIS
Checks a run name (QUOTE_JOURNEY_RUN_NAME, or -RunName) can be a folder name on both Windows and Linux.

.DESCRIPTION
Dot-source this file, then call Get-RunNameProblem. It applies the same rules as validateRunName in src/run-name.ts, so
Run-Project.ps1 -Interactive and Create-ZipFromOutput.ps1 refuse the same names as the npm commands.
#>

#Requires -Version 7.4
Set-StrictMode -Version Latest                   # error on undefined variables, missing properties, bad indexing
$ErrorActionPreference = 'Stop'                  # non-terminating errors become terminating
$PSNativeCommandUseErrorActionPreference = $true # non-zero exit codes from native commands (git, kubectl, go…) throw

# Says why a run name cannot be a folder name on both Windows and Linux, or returns nothing when it can; the same rules
# as validateRunName in src/run-name.ts
function Get-RunNameProblem([string]$Name) {
    if ($Name -in @('.', '..')) {
        return 'is not a folder name'
    }

    if ($Name -match '[<>:"/\\|?*]') {
        return 'contains a character Windows or Linux does not allow in a folder name (< > : " / \ | ? *)'
    }

    if ($Name.ToCharArray() | Where-Object { [int]$_ -lt 0x20 }) {
        return 'contains a control character'
    }

    if ($Name.EndsWith(' ') -or $Name.EndsWith('.')) {
        return 'ends with a space or a dot, which Windows drops from folder names'
    }

    if ($Name -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$') {
        return 'is a name Windows reserves for a device (CON, PRN, AUX, NUL, COM1-9, LPT1-9)'
    }

    if ([System.Text.Encoding]::UTF8.GetByteCount($Name) -gt 255) {
        return 'is longer than 255 bytes'
    }

    if ($Name.ToLowerInvariant() -in @('dev', 'stg', 'tst')) {
        return "is an environment name; leave the run name out to use that environment's folder"
    }

    return $null
}
