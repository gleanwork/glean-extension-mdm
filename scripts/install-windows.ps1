#
# MDM install script for Windows.
# Installs the Glean MDM extension into Cursor and deploys the config file.
#
# Usage: install-windows.ps1 -GleanMcpUrl <url> [-ServerName <name>]
#
# This script is intended to be run by MDM (Intune, SCCM, etc.) with admin privileges.

param(
    [Parameter(Mandatory=$true)]
    [string]$GleanMcpUrl,

    [Parameter(Mandatory=$false)]
    [string]$ServerName = "glean_default_mdm"
)

$ErrorActionPreference = "Stop"

$VsixDownloadUrl = "https://github.com/gleanwork/glean-extension-mdm/releases/latest/download/glean-mdm.vsix"
$VsixPath = Join-Path $env:TEMP "glean-mdm.vsix"
$ConfigDir = Join-Path $env:ProgramData "Glean MDM"
$ConfigPath = Join-Path $ConfigDir "mcp-config.json"

# Deploy config file
if (-not (Test-Path $ConfigDir)) {
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
}

$config = @{
    serverName = $ServerName
    url = $GleanMcpUrl
} | ConvertTo-Json -Depth 2

Set-Content -Path $ConfigPath -Value $config -Encoding UTF8
Write-Host "Config written to $ConfigPath"

# Locate the Cursor CLI, checking PATH and well-known install locations.
# When MDM (Intune, SCCM) runs this script as SYSTEM, PATH may not include
# the directory where cursor.cmd is installed.
function Find-CursorCli {
    # 1. Check PATH
    $cmd = Get-Command cursor -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    # 2. Check machine-wide install
    $machinePath = Join-Path $env:ProgramFiles "Cursor\resources\app\bin\cursor.cmd"
    if (Test-Path $machinePath) {
        return $machinePath
    }

    # 3. Check per-user installs across all user profiles
    $usersDir = Split-Path $env:PUBLIC
    foreach ($profile in Get-ChildItem $usersDir -Directory -ErrorAction SilentlyContinue) {
        $userPath = Join-Path $profile.FullName "AppData\Local\Programs\cursor\resources\app\bin\cursor.cmd"
        if (Test-Path $userPath) {
            return $userPath
        }
    }

    return $null
}

$cursorCmd = Find-CursorCli
if (-not $cursorCmd) {
    Write-Error "'cursor' CLI not found in PATH or known install locations."
    exit 1
}

Write-Host "Found cursor CLI at: $cursorCmd"

Write-Host "Downloading extension from $VsixDownloadUrl..."
try {
    Invoke-WebRequest -Uri $VsixDownloadUrl -OutFile $VsixPath -UseBasicParsing
    & $cursorCmd --install-extension $VsixPath
    Remove-Item -Path $VsixPath -Force -ErrorAction SilentlyContinue
    Write-Host "Extension installed successfully."
} catch {
    Write-Error "Failed to download extension from ${VsixDownloadUrl}: $_"
    exit 1
}
