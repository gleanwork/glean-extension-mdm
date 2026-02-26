#
# MDM install script for Windows.
# Installs the Glean MDM extension into Cursor and deploys the config file.
#
# Usage: install-windows.ps1 -GleanMcpUrl <url> [-ServerName <name>] [-GaMeasurementId <id>] [-GaApiSecret <secret>]
#
# This script is intended to be run by MDM (Intune, SCCM, etc.) with admin privileges.

param(
    [Parameter(Mandatory=$true)]
    [string]$GleanMcpUrl,

    [Parameter(Mandatory=$false)]
    [string]$ServerName = "glean_default_mdm",

    [Parameter(Mandatory=$false)]
    [string]$GaMeasurementId = "",

    [Parameter(Mandatory=$false)]
    [string]$GaApiSecret = ""
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

$configObj = @{
    serverName = $ServerName
    url = $GleanMcpUrl
}

if ($GaMeasurementId -and $GaApiSecret) {
    $configObj.gaMeasurementId = $GaMeasurementId
    $configObj.gaApiSecret = $GaApiSecret
}

$config = $configObj | ConvertTo-Json -Depth 2

Set-Content -Path $ConfigPath -Value $config -Encoding UTF8
Write-Host "Config written to $ConfigPath"

# Download and install extension if Cursor CLI is available
$cursorCmd = Get-Command cursor -ErrorAction SilentlyContinue
if (-not $cursorCmd) {
    Write-Warning "'cursor' CLI not found. Skipping extension install."
    exit 0
}

Write-Host "Downloading extension from $VsixDownloadUrl..."
try {
    Invoke-WebRequest -Uri $VsixDownloadUrl -OutFile $VsixPath -UseBasicParsing
    & cursor --install-extension $VsixPath
    Remove-Item -Path $VsixPath -Force -ErrorAction SilentlyContinue
    Write-Host "Extension installed successfully."
} catch {
    Write-Error "Failed to download extension from ${VsixDownloadUrl}: $_"
    exit 1
}
