<#
.SYNOPSIS
  scripts/bootstrap.ps1 - one-command Windows installer for the Atlas repo.

.DESCRIPTION
  Run this once from an ELEVATED PowerShell session at the repo root.
  It installs every tool the repo needs, copies the env files, generates
  the MCP token, runs pnpm install, brings up Postgres, applies migrations,
  registers the Atlas MCP server with Claude Code CLI and GitHub Copilot
  CLI, then runs pnpm doctor.

  Invocation:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1

  Parameters:
    -SkipOptionalCLIs   Skip Claude / gh / Copilot install (CI scenario).
    -NonInteractive     Take the default for every prompt (Keep on conflicts,
                        install on missing). Useful for CI and one-shot runs.

  Both .env and .env.prod are always created (from their *.example siblings)
  because the dev and prod stacks are designed to coexist - leaving one out
  breaks the other.

  Idempotent: re-running on an already-bootstrapped machine walks every
  prompt with Keep as the default, so a single Enter trip-through is safe.

  Constraints (per repo memory):
    - Pure ASCII (Windows PowerShell 5.1 reads non-BOM UTF-8 as ANSI and
      parser-errors on em-dashes, curly quotes, etc.).
    - No && / || pipeline-chain operators (PS 5.1).
    - Use `; if ($?) { ... }` or check $LASTEXITCODE instead.
#>

[CmdletBinding()]
param(
    [switch]$SkipOptionalCLIs,

    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:NonInteractive = [bool]$NonInteractive

# MCP target paths
$claudeCliConfigPath = Join-Path $env:USERPROFILE '.claude.json'
$copilotConfigPath   = Join-Path $env:USERPROFILE '.copilot\mcp-config.json'

# Desired Atlas MCP server entries.
# HTTP form for Claude Code CLI / Copilot CLI.
$desiredAtlasServerHttp = [ordered]@{
    type = 'http'
    url  = 'http://127.0.0.1:4500/mcp'
}

# stdio bridge fallback for clients that do not speak HTTP.
$desiredAtlasServerStdio = [ordered]@{
    command = 'npx'
    args    = @('-y', 'mcp-remote', 'http://127.0.0.1:4500/mcp')
}

# -----------------------------------------------------------------------------
# UI / logging helpers
# -----------------------------------------------------------------------------

function Write-Section {
    param([string]$Message)
    Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Write-Info  { param([string]$Message) Write-Host "[bootstrap] $Message" -ForegroundColor Green }
function Write-Warn  { param([string]$Message) Write-Host "[bootstrap] $Message" -ForegroundColor Yellow }
function Write-Mute  { param([string]$Message) Write-Host "[bootstrap] $Message" -ForegroundColor DarkGray }

# -----------------------------------------------------------------------------
# Preflight
# -----------------------------------------------------------------------------

function Assert-Administrator {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'This bootstrap must be run from an elevated PowerShell session.'
    }
}

function Ensure-CommandAvailable {
    param([string]$CommandName)
    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "Required command '$CommandName' was not found on PATH."
    }
}

# -----------------------------------------------------------------------------
# Prompt helpers (respect -NonInteractive)
# -----------------------------------------------------------------------------

function Read-Choice {
    param(
        [Parameter(Mandatory)][string]$Prompt,
        [Parameter(Mandatory)][hashtable]$Options,
        [string]$DefaultKey
    )

    if ($script:NonInteractive) {
        if (-not $DefaultKey) {
            throw "Read-Choice called in non-interactive mode without a default. Prompt: $Prompt"
        }
        $key = $DefaultKey.ToUpperInvariant()
        if (-not $Options.ContainsKey($key)) {
            throw "Default key '$key' not in options for prompt: $Prompt"
        }
        Write-Mute "$Prompt [auto: $key]"
        return $Options[$key]
    }

    while ($true) {
        $raw = (Read-Host $Prompt).Trim().ToUpperInvariant()
        if ([string]::IsNullOrWhiteSpace($raw) -and $DefaultKey) {
            $raw = $DefaultKey.ToUpperInvariant()
        }
        if ($Options.ContainsKey($raw)) {
            return $Options[$raw]
        }
        Write-Host "Please enter one of: $($Options.Keys -join ', ')" -ForegroundColor Yellow
    }
}

function Read-YesNo {
    param(
        [Parameter(Mandatory)][string]$Prompt,
        [string]$Default = 'Y'
    )

    $choice = Read-Choice -Prompt $Prompt -DefaultKey $Default -Options @{
        'Y' = $true
        'N' = $false
    }

    return [bool]$choice
}

# -----------------------------------------------------------------------------
# PATH refresh (process-level only)
# -----------------------------------------------------------------------------

function Refresh-CurrentSessionPath {
    param([string[]]$AdditionalPaths)

    foreach ($path in $AdditionalPaths) {
        if ([string]::IsNullOrWhiteSpace($path)) { continue }
        if (Test-Path $path) {
            $currentPath = [Environment]::GetEnvironmentVariable('PATH', 'Process')
            if ($currentPath -notlike "*$path*") {
                [Environment]::SetEnvironmentVariable('PATH', "$path;$currentPath", 'Process')
            }
        }
    }
}

# -----------------------------------------------------------------------------
# winget wrappers
# -----------------------------------------------------------------------------

function Invoke-WingetInstall {
    param(
        [Parameter(Mandatory)][string]$PackageId,
        [Parameter(Mandatory)][string]$DisplayName
    )

    Write-Warn "Installing $DisplayName ($PackageId) ..."
    & winget install --id $PackageId --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "winget install failed for $DisplayName ($PackageId) with exit code $LASTEXITCODE."
    }
}

function Invoke-WingetUpgrade {
    param(
        [Parameter(Mandatory)][string]$PackageId,
        [Parameter(Mandatory)][string]$DisplayName
    )

    Write-Warn "Upgrading $DisplayName ($PackageId) ..."
    & winget upgrade --id $PackageId --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Host
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) {
        # -1978335189 = APPINSTALLER_CLI_ERROR_UPDATE_NOT_APPLICABLE (nothing to upgrade)
        throw "winget upgrade failed for $DisplayName ($PackageId) with exit code $LASTEXITCODE."
    }
}

# -----------------------------------------------------------------------------
# JSON helpers (MCP config files)
# -----------------------------------------------------------------------------

function ConvertTo-OrderedJson {
    param([Parameter(Mandatory)]$InputObject)
    return ($InputObject | ConvertTo-Json -Depth 20)
}

function Read-JsonFile {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    $raw = Get-Content -Path $Path -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    return ($raw | ConvertFrom-Json)
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$InputObject
    )

    $directory = Split-Path -Parent $Path
    if ($directory -and -not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory | Out-Null
    }

    Set-Content -Path $Path -Value (ConvertTo-OrderedJson -InputObject $InputObject) -Encoding UTF8
}

function Ensure-ServerContainer {
    param(
        [Parameter(Mandatory)]$Config,
        [Parameter(Mandatory)][string]$ContainerName
    )

    if (-not ($Config.PSObject.Properties.Name -contains $ContainerName)) {
        $Config | Add-Member -NotePropertyName $ContainerName -NotePropertyValue ([pscustomobject]@{})
    }

    return $Config.$ContainerName
}

function Compare-JsonValue {
    param(
        [Parameter(Mandatory)]$Left,
        [Parameter(Mandatory)]$Right
    )

    return ((ConvertTo-Json $Left -Depth 20) -eq (ConvertTo-Json $Right -Depth 20))
}

function Ensure-McpServerDefinitions {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$ContainerName,
        [Parameter(Mandatory)][hashtable]$DesiredServers,
        [Parameter(Mandatory)][string]$DisplayName
    )

    $config = Read-JsonFile -Path $Path
    if (-not $config) {
        $config = [pscustomobject]@{}
    }

    $serverContainer = Ensure-ServerContainer -Config $config -ContainerName $ContainerName
    $changed = $false

    foreach ($serverName in $DesiredServers.Keys) {
        $desiredServer = [pscustomobject]$DesiredServers[$serverName]
        $existingProp  = $serverContainer.PSObject.Properties[$serverName]
        $existingServer = if ($null -ne $existingProp) { $existingProp.Value } else { $null }

        if ($null -eq $existingServer) {
            $serverContainer | Add-Member -NotePropertyName $serverName -NotePropertyValue $desiredServer
            Write-Info "Added '$serverName' to $DisplayName."
            $changed = $true
            continue
        }

        if (Compare-JsonValue -Left $existingServer -Right $desiredServer) {
            Write-Mute "'$serverName' already present in $DisplayName; leaving it unchanged."
            continue
        }

        $replace = Read-YesNo -Prompt "$DisplayName already defines '$serverName' differently. Replace it with the repo standard? (Y/N)" -Default 'N'
        if ($replace) {
            $serverContainer.PSObject.Properties.Remove($serverName)
            $serverContainer | Add-Member -NotePropertyName $serverName -NotePropertyValue $desiredServer
            Write-Warn "Updated '$serverName' in $DisplayName."
            $changed = $true
        } else {
            Write-Warn "Kept the existing '$serverName' entry in $DisplayName."
        }
    }

    if ($changed -or -not (Test-Path $Path)) {
        Write-JsonFile -Path $Path -InputObject $config
    }
}

# -----------------------------------------------------------------------------
# Tool detection
# -----------------------------------------------------------------------------

function Get-ToolVersion {
    param(
        [Parameter(Mandatory)][string]$Command,
        [string[]]$Arguments = @('--version')
    )

    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { return $null }
    try {
        $out = & $Command @Arguments 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        if ($null -eq $out) { return $null }
        return ($out | Select-Object -First 1).ToString().Trim()
    } catch {
        return $null
    }
}

function Test-DockerEngineRunning {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
    & docker version --format '{{.Server.Version}}' 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Wait-ForDockerEngine {
    param([int]$TimeoutSeconds = 90)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    Write-Warn "Waiting up to $TimeoutSeconds s for Docker engine to come up ..."
    while ((Get-Date) -lt $deadline) {
        if (Test-DockerEngineRunning) {
            Write-Info 'Docker engine is responsive.'
            return
        }
        Start-Sleep -Seconds 2
    }
    throw "Docker engine did not become ready within $TimeoutSeconds seconds. Open Docker Desktop manually and re-run this script."
}

# -----------------------------------------------------------------------------
# Windows platform features (WSL2, long paths)
# -----------------------------------------------------------------------------

function Test-WslConfigured {
    if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) { return $false }
    # `wsl --status` exits 0 when WSL is set up (default version configured).
    # On a fresh install, it exits non-zero with a "WSL is not installed" message.
    & wsl --status 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Enable-WslPlatform {
    Write-Section 'WSL2 (required by Docker Desktop)'

    if (Test-WslConfigured) {
        Write-Info 'WSL is already configured.'
        # Make sure default version is 2 (Docker Desktop requires v2).
        & wsl --set-default-version 2 2>$null | Out-Null
        return
    }

    $install = Read-YesNo -Prompt 'WSL2 is not configured. Install the WSL2 platform now (required for Docker Desktop on Windows)? (Y/N)' -Default 'Y'
    if (-not $install) {
        Write-Warn 'Skipped WSL2 install. Docker Desktop may refuse to start without it.'
        return
    }

    Write-Warn 'Running `wsl --install --no-distribution --no-launch` (enables features + installs WSL2 kernel; no Linux distro) ...'
    # --no-distribution: skip installing Ubuntu by default
    # --no-launch:       do not launch the distro after install
    & wsl --install --no-distribution --no-launch 2>&1 | Out-Host
    $wslExit = $LASTEXITCODE
    if ($wslExit -ne 0) {
        # Older Win 11 builds may not know --no-distribution; fall back to dism.
        Write-Warn "`wsl --install` exited with code $wslExit. Falling back to dism feature enable ..."
        & dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart | Out-Host
        & dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart | Out-Host
        & wsl --set-default-version 2 2>$null | Out-Null
    }

    Write-Warn 'WSL2 platform installed. A REBOOT may be required before Docker Desktop can start its engine.'
    Write-Warn 'If `docker version` fails after reboot, run `wsl --update` and start Docker Desktop manually.'
}

function Enable-LongPaths {
    Write-Section 'Long path support'

    $regKey  = 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem'
    $regName = 'LongPathsEnabled'
    # Get-ItemProperty returns $null when the value does not exist (with
    # SilentlyContinue), and StrictMode Latest throws on $null.<property>,
    # so guard the property access.
    $regObj = Get-ItemProperty -Path $regKey -Name $regName -ErrorAction SilentlyContinue
    $current = if ($null -ne $regObj) { $regObj.$regName } else { $null }
    if ($current -eq 1) {
        Write-Info 'Windows long paths already enabled.'
    } else {
        Write-Warn 'Enabling Windows long paths (registry LongPathsEnabled=1) ...'
        New-ItemProperty -Path $regKey -Name $regName -PropertyType DWORD -Value 1 -Force | Out-Null
        Write-Info 'Long paths enabled in registry (effective for new processes).'
    }

    # Mirror for git so cloning deep paths does not fail.
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $gitLongPaths = (& git config --system --get core.longpaths 2>$null)
        if ($LASTEXITCODE -eq 0 -and $gitLongPaths -eq 'true') {
            Write-Mute 'git core.longpaths already true (system).'
        } else {
            & git config --system core.longpaths true 2>&1 | Out-Host
            if ($LASTEXITCODE -eq 0) { Write-Info 'git core.longpaths set true (system).' }
            else                     { Write-Warn 'git config --system core.longpaths failed (continuing).' }
        }
    }
}

# -----------------------------------------------------------------------------
# Core tools
# -----------------------------------------------------------------------------

function Ensure-Git {
    Write-Section 'Git'
    $version = Get-ToolVersion -Command 'git'
    if ($version) {
        Write-Info "Git detected: $version"
        $choice = Read-Choice -Prompt 'Git is already installed. Keep (K), upgrade (U), or abort (A)?' -DefaultKey 'K' -Options @{
            'K' = 'keep'; 'U' = 'upgrade'; 'A' = 'abort'
        }
        switch ($choice) {
            'keep'    { }
            'upgrade' { Invoke-WingetUpgrade -PackageId 'Git.Git' -DisplayName 'Git' }
            'abort'   { throw 'Bootstrap aborted by user before changing Git.' }
        }
    } else {
        Invoke-WingetInstall -PackageId 'Git.Git' -DisplayName 'Git'
    }

    Refresh-CurrentSessionPath -AdditionalPaths @('C:\Program Files\Git\cmd')
    Ensure-CommandAvailable -CommandName 'git'
    Write-Info "Git ready: $(Get-ToolVersion -Command 'git')"
}

function Ensure-Node {
    Write-Section 'Node.js (LTS, >=20)'
    $version = Get-ToolVersion -Command 'node'
    if ($version) {
        Write-Info "Node.js detected: $version"
        $major = 0
        if ($version -match 'v?(\d+)') { $major = [int]$Matches[1] }
        if ($major -lt 20) {
            Write-Warn "Node $version is older than the required >=20 LTS. Upgrading."
            Invoke-WingetUpgrade -PackageId 'OpenJS.NodeJS.LTS' -DisplayName 'Node.js LTS'
        } else {
            $choice = Read-Choice -Prompt 'Node.js is already installed. Keep (K), upgrade to latest LTS (U), or abort (A)?' -DefaultKey 'K' -Options @{
                'K' = 'keep'; 'U' = 'upgrade'; 'A' = 'abort'
            }
            switch ($choice) {
                'keep'    { }
                'upgrade' { Invoke-WingetUpgrade -PackageId 'OpenJS.NodeJS.LTS' -DisplayName 'Node.js LTS' }
                'abort'   { throw 'Bootstrap aborted by user before changing Node.js.' }
            }
        }
    } else {
        Invoke-WingetInstall -PackageId 'OpenJS.NodeJS.LTS' -DisplayName 'Node.js LTS'
    }

    Refresh-CurrentSessionPath -AdditionalPaths @('C:\Program Files\nodejs')
    Ensure-CommandAvailable -CommandName 'node'
    Ensure-CommandAvailable -CommandName 'npm'

    $finalVersion = Get-ToolVersion -Command 'node'
    if (-not $finalVersion) { throw 'Node.js is not available in the current session after installation.' }
    Write-Info "Node.js ready: $finalVersion"
}

function Ensure-Pnpm {
    Write-Section 'pnpm (>=9)'
    $version = Get-ToolVersion -Command 'pnpm'
    if ($version) {
        Write-Info "pnpm detected: $version"
        $major = 0
        if ($version -match '^(\d+)') { $major = [int]$Matches[1] }
        if ($major -lt 9) {
            Write-Warn "pnpm $version is older than the required >=9. Upgrading."
            & npm install -g pnpm@latest | Out-Host
            if ($LASTEXITCODE -ne 0) { throw "npm install -g pnpm@latest failed with exit code $LASTEXITCODE." }
        } else {
            $choice = Read-Choice -Prompt 'pnpm is already installed. Keep (K), upgrade to latest (U), or abort (A)?' -DefaultKey 'K' -Options @{
                'K' = 'keep'; 'U' = 'upgrade'; 'A' = 'abort'
            }
            switch ($choice) {
                'keep'    { }
                'upgrade' {
                    & npm install -g pnpm@latest | Out-Host
                    if ($LASTEXITCODE -ne 0) { throw "npm install -g pnpm@latest failed with exit code $LASTEXITCODE." }
                }
                'abort'   { throw 'Bootstrap aborted by user before changing pnpm.' }
            }
        }
    } else {
        Write-Warn 'Installing pnpm globally via npm ...'
        & npm install -g pnpm@latest | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "npm install -g pnpm@latest failed with exit code $LASTEXITCODE." }
    }

    # npm global install drops shims into %APPDATA%\npm
    Refresh-CurrentSessionPath -AdditionalPaths @((Join-Path $env:APPDATA 'npm'))
    Ensure-CommandAvailable -CommandName 'pnpm'
    Write-Info "pnpm ready: $(Get-ToolVersion -Command 'pnpm')"
}

function Ensure-Docker {
    Write-Section 'Docker Desktop'
    $version = Get-ToolVersion -Command 'docker'
    if ($version) {
        Write-Info "Docker CLI detected: $version"
        $choice = Read-Choice -Prompt 'Docker is already installed. Keep (K), upgrade (U), or abort (A)?' -DefaultKey 'K' -Options @{
            'K' = 'keep'; 'U' = 'upgrade'; 'A' = 'abort'
        }
        switch ($choice) {
            'keep'    { }
            'upgrade' { Invoke-WingetUpgrade -PackageId 'Docker.DockerDesktop' -DisplayName 'Docker Desktop' }
            'abort'   { throw 'Bootstrap aborted by user before changing Docker.' }
        }
    } else {
        Invoke-WingetInstall -PackageId 'Docker.DockerDesktop' -DisplayName 'Docker Desktop'
        Write-Warn 'Docker Desktop installed. A reboot or sign-out may be required before the engine starts cleanly.'
    }

    Refresh-CurrentSessionPath -AdditionalPaths @('C:\Program Files\Docker\Docker\resources\bin')
    Ensure-CommandAvailable -CommandName 'docker'

    if (-not (Test-DockerEngineRunning)) {
        Write-Warn 'Docker engine is not running. Attempting to start Docker Desktop ...'
        $desktopExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
        if (Test-Path $desktopExe) {
            $null = Start-Process -FilePath $desktopExe -PassThru
            Wait-ForDockerEngine -TimeoutSeconds 120
        } else {
            throw "Docker Desktop executable not found at '$desktopExe'. Install or repair Docker Desktop and re-run this script."
        }
    } else {
        Write-Info 'Docker engine is running.'
    }
}

# -----------------------------------------------------------------------------
# Optional CLIs (Claude Code, GitHub CLI, GitHub Copilot CLI)
# -----------------------------------------------------------------------------

function Prompt-OptionalInstall {
    param(
        [Parameter(Mandatory)][string]$DisplayName,
        [string]$ExtraContext = ''
    )

    $msg = "Install $DisplayName? (Y/N)"
    if ($ExtraContext) { $msg = "$DisplayName - $ExtraContext`n$msg" }
    return Read-YesNo -Prompt $msg -Default 'Y'
}

function Ensure-GitHubCli {
    Write-Section 'GitHub CLI (gh)'
    if ($SkipOptionalCLIs) {
        Write-Mute 'Skipping (SkipOptionalCLIs flag set).'
        return
    }

    $version = Get-ToolVersion -Command 'gh'
    if ($version) {
        Write-Info "gh detected: $version"
        $choice = Read-Choice -Prompt 'gh is already installed. Keep (K), upgrade (U), or skip (S)?' -DefaultKey 'K' -Options @{
            'K' = 'keep'; 'U' = 'upgrade'; 'S' = 'skip'
        }
        switch ($choice) {
            'keep'    { }
            'upgrade' { Invoke-WingetUpgrade -PackageId 'GitHub.cli' -DisplayName 'GitHub CLI' }
            'skip'    { return }
        }
    } else {
        $install = Prompt-OptionalInstall -DisplayName 'GitHub CLI (gh)' -ExtraContext 'Useful for PAT helpers and gh-copilot extension.'
        if (-not $install) {
            Write-Mute 'Skipped GitHub CLI by user choice.'
            return
        }
        Invoke-WingetInstall -PackageId 'GitHub.cli' -DisplayName 'GitHub CLI'
    }

    Refresh-CurrentSessionPath -AdditionalPaths @('C:\Program Files\GitHub CLI')
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        Write-Info "gh ready: $(Get-ToolVersion -Command 'gh')"
    } else {
        Write-Warn 'gh not on PATH after install. You may need to open a new shell.'
    }
}

function Ensure-CopilotExtension {
    Write-Section 'GitHub Copilot CLI (gh extension)'
    if ($SkipOptionalCLIs) {
        Write-Mute 'Skipping (SkipOptionalCLIs flag set).'
        return
    }

    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Mute 'gh is not installed; skipping Copilot extension.'
        return
    }

    # Probe whether the extension is already present
    $extList = & gh extension list 2>$null
    $hasCopilot = ($LASTEXITCODE -eq 0) -and ($extList -match 'github/gh-copilot')

    if ($hasCopilot) {
        Write-Info 'gh-copilot extension already installed.'
        $choice = Read-Choice -Prompt 'gh copilot is already installed. Keep (K), upgrade (U), or skip (S)?' -DefaultKey 'K' -Options @{
            'K' = 'keep'; 'U' = 'upgrade'; 'S' = 'skip'
        }
        switch ($choice) {
            'keep'    { return }
            'upgrade' {
                & gh extension upgrade github/gh-copilot 2>&1 | Out-Host
                if ($LASTEXITCODE -ne 0) { Write-Warn "gh extension upgrade exited with code $LASTEXITCODE (continuing)." }
                return
            }
            'skip'    { return }
        }
    }

    $install = Prompt-OptionalInstall -DisplayName 'GitHub Copilot CLI' -ExtraContext 'Adds `gh copilot suggest / explain`. Requires `gh auth login` afterwards.'
    if (-not $install) {
        Write-Mute 'Skipped Copilot extension by user choice.'
        return
    }

    # Check gh auth status; warn (but do not block) if logged out
    & gh auth status 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Warn 'gh is not authenticated. Run `gh auth login` after bootstrap completes, then re-run to enable Copilot.'
        Write-Warn 'Attempting extension install anyway in case the registry is reachable ...'
    }

    & gh extension install github/gh-copilot 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "gh extension install github/gh-copilot exited with code $LASTEXITCODE. Re-run after `gh auth login`."
        return
    }
    Write-Info 'gh-copilot extension installed.'
}

function Ensure-ClaudeCli {
    Write-Section 'Claude Code CLI (claude)'
    if ($SkipOptionalCLIs) {
        Write-Mute 'Skipping (SkipOptionalCLIs flag set).'
        return
    }

    $version = Get-ToolVersion -Command 'claude'
    if ($version) {
        Write-Info "claude detected: $version"
        $choice = Read-Choice -Prompt 'Claude Code CLI is already installed. Keep (K), upgrade (U), or skip (S)?' -DefaultKey 'K' -Options @{
            'K' = 'keep'; 'U' = 'upgrade'; 'S' = 'skip'
        }
        switch ($choice) {
            'keep'    { }
            'upgrade' { Invoke-WingetUpgrade -PackageId 'Anthropic.ClaudeCode' -DisplayName 'Claude Code CLI' }
            'skip'    { return }
        }
    } else {
        $install = Prompt-OptionalInstall -DisplayName 'Claude Code CLI' -ExtraContext 'Required only for live agent runs (ATLAS_AI_ENABLED=true).'
        if (-not $install) {
            Write-Mute 'Skipped Claude Code CLI by user choice.'
            return
        }
        Invoke-WingetInstall -PackageId 'Anthropic.ClaudeCode' -DisplayName 'Claude Code CLI'
    }

    Refresh-CurrentSessionPath -AdditionalPaths @((Join-Path $env:LocalAppData 'Programs\claude'))
    if (Get-Command claude -ErrorAction SilentlyContinue) {
        Write-Info "claude ready: $(Get-ToolVersion -Command 'claude')"
    } else {
        Write-Warn 'claude not on PATH after install. You may need to open a new shell.'
    }
}

# -----------------------------------------------------------------------------
# Repo-side setup
# -----------------------------------------------------------------------------

function Ensure-EnvFile {
    param(
        [Parameter(Mandatory)][ValidateSet('dev', 'prod')][string]$Mode
    )

    $exampleName = if ($Mode -eq 'prod') { '.env.prod.example' } else { '.env.example' }
    $targetName  = if ($Mode -eq 'prod') { '.env.prod' }         else { '.env' }
    $examplePath = Join-Path $repoRoot $exampleName
    $targetPath  = Join-Path $repoRoot $targetName

    if (-not (Test-Path $examplePath)) {
        throw "Missing $exampleName at repo root - cannot bootstrap. Run from the repo root."
    }

    if (Test-Path $targetPath) {
        Write-Mute "$targetName already exists; keeping the current file."
        return
    }

    Copy-Item -Path $examplePath -Destination $targetPath
    Write-Info "Created $targetName from $exampleName."
}

function New-McpTokenValue {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $buffer = New-Object byte[] 48
        $rng.GetBytes($buffer)
        # Base64url (no padding)
        $b64 = [Convert]::ToBase64String($buffer)
        return ($b64.TrimEnd('=') -replace '\+', '-' -replace '/', '_')
    } finally {
        $rng.Dispose()
    }
}

function Ensure-McpToken {
    param(
        [Parameter(Mandatory)][ValidateSet('dev', 'prod')][string]$Mode
    )

    $targetName = if ($Mode -eq 'prod') { '.env.prod' } else { '.env' }
    $targetPath = Join-Path $repoRoot $targetName
    if (-not (Test-Path $targetPath)) {
        Write-Mute "$targetName not found; skipping ATLAS_MCP_TOKEN."
        return
    }

    $content = Get-Content -Path $targetPath -Raw
    if ($content -match '(?m)^ATLAS_MCP_TOKEN=\S+') {
        Write-Mute "$targetName already has a non-empty ATLAS_MCP_TOKEN; leaving it."
        return
    }

    $generate = Read-YesNo -Prompt "ATLAS_MCP_TOKEN is empty in $targetName. Generate a 48-byte random token now? (Y/N)" -Default 'Y'
    if (-not $generate) {
        Write-Mute "Skipped ATLAS_MCP_TOKEN generation for $targetName."
        return
    }

    $token = New-McpTokenValue
    if ($content -match '(?m)^ATLAS_MCP_TOKEN=.*$') {
        $content = [regex]::Replace($content, '(?m)^ATLAS_MCP_TOKEN=.*$', "ATLAS_MCP_TOKEN=$token")
    } else {
        $content = $content.TrimEnd() + "`r`nATLAS_MCP_TOKEN=$token`r`n"
    }
    Set-Content -Path $targetPath -Value $content -Encoding UTF8
    Write-Info "Generated ATLAS_MCP_TOKEN in $targetName."
}

function Ensure-PnpmInstall {
    Write-Section 'pnpm install'
    $nodeModules = Join-Path $repoRoot 'node_modules'
    if (Test-Path $nodeModules) {
        $choice = Read-Choice -Prompt 'node_modules exists. Keep (K), refresh with pnpm install (R), or abort (A)?' -DefaultKey 'K' -Options @{
            'K' = 'keep'; 'R' = 'refresh'; 'A' = 'abort'
        }
        switch ($choice) {
            'keep'    { Write-Mute 'Keeping existing node_modules.'; return }
            'refresh' { }
            'abort'   { throw 'Bootstrap aborted by user before pnpm install.' }
        }
    }

    Push-Location $repoRoot
    try {
        & pnpm install | Out-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "pnpm install exited with code $LASTEXITCODE."
            $offerBuildTools = Read-YesNo -Prompt 'If the failure was a node-pty / node-gyp native build error, installing Python 3.12 + VS 2022 Build Tools (~5 GB) and retrying may help. Install and retry now? (Y/N)' -Default 'N'
            if ($offerBuildTools) {
                Ensure-BuildTools
                Write-Warn 'Retrying pnpm install ...'
                & pnpm install | Out-Host
                if ($LASTEXITCODE -ne 0) {
                    throw "pnpm install failed again with exit code $LASTEXITCODE after build tools install."
                }
            } else {
                throw "pnpm install failed with exit code $LASTEXITCODE."
            }
        }
    } finally {
        Pop-Location
    }
}

function Ensure-BuildTools {
    Write-Section 'Native build tools (Python + VS Build Tools)'

    $pythonVersion = Get-ToolVersion -Command 'python'
    if (-not $pythonVersion) { $pythonVersion = Get-ToolVersion -Command 'py' -Arguments @('-3', '--version') }
    if ($pythonVersion) {
        Write-Info "Python detected: $pythonVersion"
    } else {
        Invoke-WingetInstall -PackageId 'Python.Python.3.12' -DisplayName 'Python 3.12'
        Refresh-CurrentSessionPath -AdditionalPaths @(
            (Join-Path $env:LocalAppData 'Programs\Python\Python312'),
            (Join-Path $env:LocalAppData 'Programs\Python\Python312\Scripts')
        )
    }

    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $hasBuildTools = $false
    if (Test-Path $vswhere) {
        $found = & $vswhere -products Microsoft.VisualStudio.Product.BuildTools -property installationPath 2>$null
        if ($LASTEXITCODE -eq 0 -and $found) { $hasBuildTools = $true }
    }
    if ($hasBuildTools) {
        Write-Info 'Visual Studio Build Tools already installed.'
    } else {
        Write-Warn 'Installing Visual Studio 2022 Build Tools (this is a ~5 GB download) ...'
        # Override winget package args to add the VC++ workload.
        & winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --silent --accept-package-agreements --accept-source-agreements --override '--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --quiet --wait --norestart' | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "winget install of VS 2022 Build Tools failed with exit code $LASTEXITCODE."
        }
    }
}

function Ensure-DatabaseUp {
    Write-Section 'Database (Postgres via Docker Compose)'

    if (-not (Test-DockerEngineRunning)) {
        Wait-ForDockerEngine -TimeoutSeconds 60
    }

    Push-Location $repoRoot
    try {
        Write-Warn 'pnpm db:up ...'
        & pnpm db:up | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "pnpm db:up failed with exit code $LASTEXITCODE." }

        Write-Warn 'pnpm db:wait ...'
        & pnpm db:wait | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "pnpm db:wait failed with exit code $LASTEXITCODE." }

        Write-Warn 'pnpm db:migrate ...'
        & pnpm db:migrate | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "pnpm db:migrate failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
    Write-Info 'Database is up and migrated.'
}

function Ensure-McpClientConfigs {
    Write-Section 'MCP client registration'
    Write-Mute 'Existing entries on every client are preserved unless you opt to replace.'

    # 1. Claude Code CLI: prefer `claude mcp add-json` when claude is installed,
    #    otherwise edit ~/.claude.json directly.
    if (Get-Command claude -ErrorAction SilentlyContinue) {
        # `claude mcp list` to check; `mcp add-json` to add (idempotent: errors if exists)
        $list = & claude mcp list 2>$null
        if ($LASTEXITCODE -eq 0 -and ($list -match '(?m)^\s*atlas\s')) {
            Write-Mute 'atlas already registered with Claude Code CLI.'
        } else {
            Write-Warn 'Registering atlas with Claude Code CLI ...'
            $json = '{"url":"http://127.0.0.1:4500/mcp"}'
            & claude mcp add-json atlas --scope user $json 2>&1 | Out-Host
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "claude mcp add-json exited with code $LASTEXITCODE. Falling back to editing ~/.claude.json."
                Ensure-McpServerDefinitions `
                    -Path $claudeCliConfigPath `
                    -ContainerName 'mcpServers' `
                    -DesiredServers @{ atlas = $desiredAtlasServerHttp } `
                    -DisplayName '~/.claude.json'
            } else {
                Write-Info 'atlas registered with Claude Code CLI.'
            }
        }
    } else {
        Write-Mute 'claude not installed; skipping Claude Code CLI registration.'
    }

    # 2. GitHub Copilot CLI config
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        $hasCopilot = $false
        $extList = & gh extension list 2>$null
        if ($LASTEXITCODE -eq 0 -and ($extList -match 'github/gh-copilot')) { $hasCopilot = $true }
        if ($hasCopilot) {
            # Copilot CLI accepts HTTP form; fall back to stdio bridge if user already has stdio configured.
            Ensure-McpServerDefinitions `
                -Path $copilotConfigPath `
                -ContainerName 'mcpServers' `
                -DesiredServers @{ atlas = $desiredAtlasServerHttp } `
                -DisplayName 'GitHub Copilot CLI config'
        } else {
            Write-Mute 'gh-copilot extension not installed; skipping Copilot CLI config.'
        }
    } else {
        Write-Mute 'gh not installed; skipping Copilot CLI config.'
    }
}

# -----------------------------------------------------------------------------
# Verification
# -----------------------------------------------------------------------------

function Invoke-Doctor {
    Write-Section 'Verification (pnpm doctor)'
    Push-Location $repoRoot
    try {
        & pnpm doctor | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "pnpm doctor reported missing prerequisites (exit code $LASTEXITCODE). Review the output above."
        }
    } finally {
        Pop-Location
    }
    Write-Info 'pnpm doctor passed.'
}

# -----------------------------------------------------------------------------
# Main flow
# -----------------------------------------------------------------------------

function Invoke-Bootstrap {
    Assert-Administrator
    Ensure-CommandAvailable -CommandName 'winget'

    Write-Section 'Atlas bootstrap start'
    Write-Info "Repo root:     $repoRoot"
    if ($script:NonInteractive) { Write-Info 'Mode:          NON-INTERACTIVE (defaults applied automatically).' }
    if ($SkipOptionalCLIs)      { Write-Info 'Mode:          SKIP optional CLIs (Claude / gh / Copilot).' }

    # Windows platform prerequisites that do not require any tools yet.
    Enable-WslPlatform

    # Tool installs
    Ensure-Git
    # Long-path registry tweak + `git config --system core.longpaths` belong
    # AFTER Git is installed, so the git-side half does not silently no-op
    # on a fresh box.
    Enable-LongPaths
    Ensure-Node
    Ensure-Pnpm
    Ensure-Docker
    Ensure-GitHubCli
    Ensure-CopilotExtension
    Ensure-ClaudeCli

    # Repo-side setup
    Write-Section 'Repo setup'
    Ensure-EnvFile -Mode 'dev'
    Ensure-EnvFile -Mode 'prod'
    Ensure-McpToken -Mode 'dev'
    Ensure-McpToken -Mode 'prod'
    Ensure-PnpmInstall
    Ensure-DatabaseUp
    Ensure-McpClientConfigs

    # Verification
    Invoke-Doctor

    Write-Section 'Bootstrap complete'
    Write-Info 'The repo is ready. Next steps:'
    Write-Host ''
    Write-Host '    pnpm dev' -ForegroundColor Green
    Write-Host ''
    Write-Host '  Then open http://localhost:4000 in your browser.' -ForegroundColor Green
    Write-Host '  API: http://localhost:4001    MCP: http://localhost:4500/mcp    Postgres: localhost:5500' -ForegroundColor DarkGray

    # Auth follow-ups for tools that need interactive login flows the script
    # cannot reliably drive. We do not check claude's actual auth state (the
    # CLI has no portable status command), so the reminder fires whenever
    # claude is installed - harmless if the user is already signed in.
    $claudeInstalled = (Get-Command claude -ErrorAction SilentlyContinue) -ne $null
    $ghNeedsAuth     = $false
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        & gh auth status 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { $ghNeedsAuth = $true }
    }

    if ($claudeInstalled -or $ghNeedsAuth) {
        Write-Host ''
        Write-Mute 'Manual auth steps (these need a real browser / interactive login):'
        if ($claudeInstalled) { Write-Mute '    claude login           # sign in to Anthropic if you have not already' }
        if ($ghNeedsAuth)     { Write-Mute '    gh auth login          # sign in to GitHub (also unlocks `gh copilot`)' }
    }

    Write-Host ''
    Write-Mute 'If you enabled WSL2 in this run, a reboot may be required before `pnpm dev` can reach the Docker engine.'
}

Invoke-Bootstrap
