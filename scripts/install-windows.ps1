#
# MDM install script for Windows.
# Installs the Glean extension into Cursor, Windsurf, and/or Antigravity and deploys the config file.
#
# Usage: install-windows.ps1 -GleanMcpUrl <url> [-ServerName <name>]
#
# This script is intended to be run by MDM (Intune, SCCM, etc.) with admin privileges.

param(
    [Parameter(Mandatory=$true)]
    [string]$GleanMcpUrl,

    [Parameter(Mandatory=$false)]
    [string]$ServerName = "glean-default"
)

$ErrorActionPreference = "Stop"

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

# Locate the Windsurf CLI, checking PATH and well-known install locations.
function Find-WindsurfCli {
    # 1. Check PATH
    $cmd = Get-Command windsurf -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    # 2. Check machine-wide install
    $machinePath = Join-Path $env:ProgramFiles "Windsurf\resources\app\bin\windsurf.cmd"
    if (Test-Path $machinePath) {
        return $machinePath
    }

    # 3. Check per-user installs across all user profiles
    $usersDir = Split-Path $env:PUBLIC
    foreach ($profile in Get-ChildItem $usersDir -Directory -ErrorAction SilentlyContinue) {
        $userPath = Join-Path $profile.FullName "AppData\Local\Programs\windsurf\resources\app\bin\windsurf.cmd"
        if (Test-Path $userPath) {
            return $userPath
        }
    }

    return $null
}

# Locate the Antigravity CLI, checking PATH and well-known install locations.
function Find-AntigravityCli {
    # 1. Check PATH
    $cmd = Get-Command antigravity -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    # 2. Check machine-wide install
    $machinePath = Join-Path $env:ProgramFiles "Antigravity\resources\app\bin\antigravity.cmd"
    if (Test-Path $machinePath) {
        return $machinePath
    }

    # 3. Check per-user installs across all user profiles
    $usersDir = Split-Path $env:PUBLIC
    foreach ($profile in Get-ChildItem $usersDir -Directory -ErrorAction SilentlyContinue) {
        $userPath = Join-Path $profile.FullName "AppData\Local\Programs\antigravity\resources\app\bin\antigravity.cmd"
        if (Test-Path $userPath) {
            return $userPath
        }
    }

    return $null
}

$targetUser = (Get-WmiObject -Class Win32_ComputerSystem).UserName
if ($targetUser -match '\\') {
    $targetUser = $targetUser.Split('\')[-1]
}

if (-not $targetUser) {
    Write-Error "Could not determine a logged-in target user."
    exit 1
}

$targetHome = (Get-CimInstance Win32_UserProfile | Where-Object {
    $_.LocalPath -like "*\$targetUser"
}).LocalPath

if (-not $targetHome) {
    Write-Error "Could not determine home directory for user: $targetUser"
    exit 1
}

Write-Host "Target user: $targetUser"
Write-Host "Target home: $targetHome"

$installed = 0

# Install into Cursor if available
$cursorCmd = Find-CursorCli
if ($cursorCmd) {
    Write-Host "Found cursor CLI at: $cursorCmd"
    $extDir = Join-Path $targetHome ".cursor\extensions"
    Write-Host "Installing Cursor extension as $targetUser..."
    & $cursorCmd --install-extension glean.glean --extensions-dir $extDir

    # Ensure the target user owns the installed files
    icacls $extDir /grant "${targetUser}:(OI)(CI)F" /T /Q 2>$null | Out-Null

    Write-Host "Cursor extension installed successfully."
    $installed = 1
} else {
    Write-Host "Cursor CLI not found, skipping Cursor installation."
}

# Install into Windsurf if available
$windsurfCmd = Find-WindsurfCli
if ($windsurfCmd) {
    Write-Host "Found windsurf CLI at: $windsurfCmd"
    $extDir = Join-Path $targetHome ".windsurf\extensions"
    Write-Host "Installing Windsurf extension as $targetUser..."
    & $windsurfCmd --install-extension glean.glean --extensions-dir $extDir

    # Ensure the target user owns the installed files
    icacls $extDir /grant "${targetUser}:(OI)(CI)F" /T /Q 2>$null | Out-Null

    Write-Host "Windsurf extension installed successfully."
    $installed = 1
} else {
    Write-Host "Windsurf CLI not found, skipping Windsurf installation."
}

# Install into Antigravity if available
$antigravityCmd = Find-AntigravityCli
if ($antigravityCmd) {
    Write-Host "Found antigravity CLI at: $antigravityCmd"
    $extDir = Join-Path $targetHome ".antigravity\extensions"
    Write-Host "Installing Antigravity extension as $targetUser..."
    & $antigravityCmd --install-extension glean.glean --extensions-dir $extDir

    # Ensure the target user owns the installed files
    icacls $extDir /grant "${targetUser}:(OI)(CI)F" /T /Q 2>$null | Out-Null

    Write-Host "Antigravity extension installed successfully."
    $installed = 1
} else {
    Write-Host "Antigravity CLI not found, skipping Antigravity installation."
}

if ($installed -eq 0) {
    Write-Error "No supported editor CLI (Cursor, Windsurf, Antigravity) found in PATH or known install locations."
    exit 1
}
