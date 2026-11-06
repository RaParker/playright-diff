#!/usr/bin/env pwsh

<#
.SYNOPSIS
Zips a policy's output folder (<policy-details-id>-<history-id>) from the output folder set in .env.

.DESCRIPTION
The output folder is DIFF_OUTPUT_DIR, taken from the environment when it is set there, otherwise from this project's
.env, otherwise this project's folder - the same order the npm commands use. The policy's folder in it is zipped to
<policy-details-id>-<history-id>.zip, so the zip extracts to a folder of the same name.

When the zip already exists you are asked whether to replace it, unless -Force is given.

.PARAMETER PolicyDetailsId
The policy details ID, as a GUID with the '-' removed.

.PARAMETER HistoryId
The history ID, a non-negative whole number. Defaults to 1.

.PARAMETER Destination
The folder to write the zip to. Defaults to the output folder, and is created if it doesn't exist.

.PARAMETER Force
Replace an existing zip without asking.

.PARAMETER EnvFile
The .env file to read DIFF_OUTPUT_DIR from. Defaults to this project's .env.

.PARAMETER Help
Show this help.

.EXAMPLE
./Create-ZipFromOutput.ps1 106D1920D02642E2A0F55131BB75ED7D

Zips <output folder>/106D1920D02642E2A0F55131BB75ED7D-1 to <output folder>/106D1920D02642E2A0F55131BB75ED7D-1.zip.

.EXAMPLE
./Create-ZipFromOutput.ps1 106D1920D02642E2A0F55131BB75ED7D 2 -Force

Zips history 2, replacing any existing zip without asking.
#>
[CmdletBinding(DefaultParameterSetName = "Zip")]
param(
    [Parameter(Mandatory, Position = 0, ParameterSetName = "Zip")]
    [string]$PolicyDetailsId,

    [Parameter(Position = 1, ParameterSetName = "Zip")]
    [string]$HistoryId = "1",

    [Parameter(Position = 2, ParameterSetName = "Zip")]
    [string]$Destination,

    [Parameter(ParameterSetName = "Zip")]
    [switch]$Force,

    [Parameter(ParameterSetName = "Zip")]
    [string]$EnvFile = (Join-Path $PSScriptRoot ".env"),

    [Parameter(Mandatory, ParameterSetName = "Help")]
    [switch]$Help
)

function Get-OutputFolder([string]$Path) {
    if ($env:DIFF_OUTPUT_DIR) {
        return $env:DIFF_OUTPUT_DIR
    }

    $fromEnvFile = Get-EnvFileValue $Path "DIFF_OUTPUT_DIR"
    if ($fromEnvFile) {
        return $fromEnvFile
    }

    return $PSScriptRoot
}

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

if ($Help) {
    . (Join-Path $PSScriptRoot "scripts" "Get-ScriptHelpText.ps1")
    Write-Host (Get-ScriptHelpText $PSCommandPath)
    exit 0
}

if ($PolicyDetailsId -notmatch "^[0-9A-Fa-f]{32}$") {
    Write-Host "PolicyDetailsId must be a GUID with the '-' removed (32 hex characters), got '$PolicyDetailsId'" -ForegroundColor Red
    exit 1
}

$historyIdValue = 0
if (![int]::TryParse($HistoryId, [ref]$historyIdValue) -or $historyIdValue -lt 0) {
    Write-Host "HistoryId must be a non-negative whole number, got '$HistoryId'" -ForegroundColor Red
    exit 1
}

$outputFolder = Get-OutputFolder $EnvFile
$policyFolderName = "$($PolicyDetailsId.ToUpperInvariant())-$historyIdValue"
$policyFolder = Join-Path $outputFolder $policyFolderName
if (!(Test-Path -LiteralPath $policyFolder -PathType Container)) {
    Write-Host "No output folder '$policyFolder'" -ForegroundColor Red
    exit 1
}

if (!$Destination) {
    $Destination = $outputFolder
}

$zipPath = Join-Path $Destination "$policyFolderName.zip"
if ((Test-Path -LiteralPath $zipPath) -and !$Force) {
    $answer = Read-Host "'$zipPath' already exists. Replace it? [y/N]"
    if ($answer -notmatch "^(y|yes)$") {
        Write-Host "Not replaced"
        exit 0
    }
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Compress-Archive -LiteralPath $policyFolder -DestinationPath $zipPath -Force
Write-Host "Zipped '$policyFolder' to '$zipPath'" -ForegroundColor Green
