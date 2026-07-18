<#
.SYNOPSIS
  scripts/setup-env.ps1 - project setup script for running Atlas inside Atlas (Windows).

.DESCRIPTION
  Invoked by Atlas's orchestrator after worktree provisioning.

  Strategy:
    1. Verify Node and pnpm are on PATH (fail fast if either is missing).
    2. Render .env at the worktree root. Walk every line of .env.example;
       for each KEY=... line, emit the override value if the key is in
       the $overrides table, otherwise emit KEY= (empty string). Comments
       and blank lines pass through unchanged. Override keys not present
       in .env.example are appended at the bottom. The result is a fully
       deterministic .env: every value comes from $overrides or is empty,
       never from a leftover .env.example default.
    3. Install workspace dependencies via pnpm so the agent CLI can
       build / test / run things in the worktree immediately.

  Secret-bearing values use ${variable.KEY} placeholders that Atlas
  substitutes before execution; unset keys produce setup_failed at
  substitution time, so set every referenced key in Settings -> Shared
  Secrets (or Project -> ENV Secrets) before dispatching.

  This script renders .env only. It does NOT render .env.prod.

  Contract reference: docs/setup-script-contract.md

  Constraints:
    - Pure ASCII (Windows PowerShell 5.1 reads non-BOM UTF-8 as ANSI and
      parser-errors on em-dashes, curly quotes, etc.).
    - No && or || pipeline-chain operators (PS 5.1 limitation); use
      `; if ($?) { ... }` instead.
#>

$ErrorActionPreference = 'Stop'
function Step($m) { Write-Host ("`n[setup] " + $m) }

# -----------------------------------------------------------------------------
# Secret values bound inside single-quote literals so Atlas's substitution
# drops the value verbatim (no PowerShell $-interpolation, no command
# expansion). Used to assemble the override table below.
# -----------------------------------------------------------------------------
$PgUser      = '${variable.POSTGRES_USER}'
$PgPassword  = '${variable.POSTGRES_PASSWORD}'
$McpToken    = '${variable.ATLAS_MCP_TOKEN}'

# -----------------------------------------------------------------------------
# Per-key overrides applied on top of .env.example.
#
# Order is preserved for keys also present in .env.example (their original
# position in the file). Override keys NOT in .env.example are appended at
# the bottom in this declaration order.
# -----------------------------------------------------------------------------
$overrides = [ordered]@{
  'POSTGRES_USER'      = $PgUser
  'POSTGRES_PASSWORD'  = $PgPassword
  'DATABASE_URL'       = "postgres://${PgUser}:${PgPassword}@localhost:5500/atlas"
  'ATLAS_MCP_TOKEN'   = $McpToken
  'ATLAS_AI_ENABLED'  = 'true'
  'ATLAS_LAN_ACCESS'  = 'true'
}
# -----------------------------------------------------------------------------

Step "1/3 verifying tool versions"
node --version
pnpm --version

Step "2/3 rendering .env from .env.example"
$exampleFile = Join-Path (Get-Location) '.env.example'
$envFile     = Join-Path (Get-Location) '.env'

if (-not (Test-Path $exampleFile)) {
  Write-Error ".env.example not found in $(Get-Location)"
  exit 1
}

# Build .env by walking .env.example. For each KEY=... line, look up the
# key in $overrides: if found, emit the override value; if not, default to
# empty string. Comments and blanks pass through. Track emitted keys so we
# can append any $overrides entry whose key did not appear in .env.example.
$lines = Get-Content $exampleFile -Encoding UTF8
$emitted = @{}
$out = New-Object System.Collections.Generic.List[string]

foreach ($line in $lines) {
  if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=') {
    $key = $Matches[1]
    if ($overrides.Contains($key)) {
      $out.Add(("{0}={1}" -f $key, $overrides[$key])) | Out-Null
    } else {
      # Default to empty string
      $out.Add(("{0}=" -f $key)) | Out-Null
    }
    $emitted[$key] = $true
  } else {
    $out.Add($line) | Out-Null
  }
}

foreach ($key in $overrides.Keys) {
  if (-not $emitted.ContainsKey($key)) {
    $out.Add(("{0}={1}" -f $key, $overrides[$key])) | Out-Null
  }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($envFile, (($out -join "`n") + "`n"), $utf8NoBom)

Step "3/3 installing node dependencies"
pnpm install --frozen-lockfile
if (-not $?) { exit 1 }

Step "done - .env at $envFile"
