#
# MDM install script for Windows.
# Installs the Glean MCP extension into Cursor and deploys the config file.
#
# Usage: install-windows.ps1 -GleanMcpUrl <url> [-ServerName <name>]
#
# This script is intended to be run by MDM (Intune, SCCM, etc.) with admin privileges.

param(
    [Parameter(Mandatory=$true)]
    [string]$GleanMcpUrl,

    [Parameter(Mandatory=$false)]
    [string]$ServerName = "glean"
)

$ErrorActionPreference = "Stop"

$VsixDownloadUrl = "https://github.com/travis-hoover-glean/glean-mcp-mdm/releases/latest/download/glean-mcp.vsix"
$VsixPath = Join-Path $env:TEMP "glean-mcp.vsix"
$ConfigDir = Join-Path $env:ProgramData "Glean"
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
