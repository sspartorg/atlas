import { db } from './kysely-client.js';
import { loadCatalog, type CatalogEntry } from '../marketplace/catalog-loader.js';
import { sourcesFor, type RegulationSource } from '../agents/sources/regulations-matrix.js';

// Theme 09 — defensive boot check that the regulations matrix has
// at least one source per project_type × region we ship. Catches
// matrix typos in the seed module (which is exercised by `pnpm
// db:seed` on a fresh DB) rather than at agent dispatch time.
function assertRegulationsMatrixHealthy(): void {
    const sample: RegulationSource[] = sourcesFor('saas', 'EU');
    if (sample.length === 0) {
        throw new Error('regulations-matrix: saas:EU returned no sources');
    }
}

// Sync the on-disk catalog (packages/api/src/marketplace/catalog/) into the
// marketplace_agents table. Idempotent: every run overwrites the row from the
// manifest, so `version` is whatever `manifest.json` declares — it is NOT
// derived from content_hash. The hash is still computed and stored, but it
// stopped driving version bumps because a hash that moved on cosmetic edits
// produced "upgrade available" banners with nothing to apply.
//
// Existing local agents are NEVER mutated here, even on catalog upgrade; the
// UI surfaces the diff and the Owner accepts. Owner edits on a local agent
// never break the back-link — they simply mean the local row diverges from the
// catalog. Detach (UI action) is the only way to clear the link.
//
// There is no second phase. Auto-installing catalog entries into `agents` was
// removed because it resurrected agents the Owner had deleted; see the note on
// `runSeed` below.
async function syncMarketplaceCatalog(): Promise<CatalogEntry[]> {
    const catalog = loadCatalog();
    if (catalog.length === 0) return [];

    const existing = await db
        .selectFrom('marketplace_agents')
        .select(['id', 'content_hash', 'version'])
        .execute();
    const existingById = new Map(existing.map((r) => [r.id, r]));

    await db.transaction().execute(async (trx) => {
        for (const entry of catalog) {
            const prior = existingById.get(entry.manifest.id);
            // Versioning is manifest-controlled: the catalog version always
            // equals the value the author declared in manifest.json. Bumping a
            // version is now an explicit edit (e.g. 1 -> 2) made alongside the
            // content change you want to publish - not a side effect of any
            // byte changing in the bundle. This kills the "upgrade available
            // but nothing to apply" banner that the old content_hash auto-bump
            // produced for metadata-only / memory.md edits (the bump surface
            // was wider than the 5 fields the upgrade modal can apply).
            // content_hash is still computed and stored below for future
            // change-detection use; it just no longer drives the version.
            const nextVersion = entry.manifest.version;
            const row = {
                id: entry.manifest.id,
                name: entry.manifest.name,
                category: entry.manifest.category,
                cli: entry.manifest.cli,
                model: entry.manifest.model,
                framework: entry.manifest.framework,
                prompt_md: entry.prompt_md,
                description: entry.manifest.description,
                designation: entry.manifest.designation,
                accent_color: entry.manifest.accent_color,
                sort_order: entry.manifest.sort_order,
                glyph: entry.manifest.glyph,
                role_id: entry.manifest.role_id,
                status: entry.manifest.status,
                kind_slug: entry.manifest.kind_slug,
                settings_json: entry.manifest.settings_json,
                memory_cadence: entry.manifest.memory_cadence,
                memory_template_md: entry.memory_md,
                summary: entry.manifest.summary,
                version: nextVersion,
                content_hash: entry.content_hash,
                published_at: entry.manifest.published_at,
                updated_at: new Date().toISOString(),
            };

            if (prior == null) {
                await trx.insertInto('marketplace_agents').values(row).execute();
            } else {
                await trx.updateTable('marketplace_agents').set(row).where('id', '=', row.id).execute();
                await trx
                    .deleteFrom('marketplace_agent_checklists')
                    .where('marketplace_agent_id', '=', row.id)
                    .execute();
            }

            if (entry.checklists.length > 0) {
                await trx
                    .insertInto('marketplace_agent_checklists')
                    .values(
                        entry.checklists.map((c) => ({
                            marketplace_agent_id: row.id,
                            label: c.label,
                            sort_order: c.sort_order,
                            required: c.required,
                        }))
                    )
                    .execute();
            }
        }
    });

    return catalog;
}

// Phase 2 of the /commands framework redesign — five artifact templates
// (`spec`, `plan`, `tasks`, `sub-task`, `qa-plan`) seeded into the
// `agent_templates` table. The templates-assembler writes each row to
// `<worktree>/.atlas/templates/<filename>` per run so the slash-command
// bodies can reference a stable shape. Owner edits via direct DB writes
// for now; the planned Settings tab follows in a separate plan.
//
// Bodies are kept short — section headers + one-line placeholders. The
// agent fills them in; the template just enforces shape.

interface AgentTemplateSeed {
    id: string;
    filename: string;
    description: string;
    body_md: string;
}

const SPEC_TEMPLATE_MD = `# Spec

> Architect-grade spec for this Task. Every section below MUST have
> substantive content before review — empty sections fail.

## Feasibility

<Is the change feasible against the project's current architecture? Quote the constraint that makes it so, or call out the blocker.>

## Tech stack

<Which packages / layers does this touch? Which language / framework choices are forced by existing code?>

## Libraries to install

<Explicit list with package names + rationale. \`(none)\` is a valid answer; silence is not.>

## File-level change list

<One \`### <sub-task id> — <title>\` group per dev sub-task, in build order. Under each, for every file that sub-task's Coder will create, edit, or delete, one line: \`<path>\` — \`<what changes>\`.>

## Test scenarios

<Given / When / Then bullets, one per acceptance criterion, mapped to the sub-tasks' existing acceptance criteria.>

## Performance + security notes

<Hot paths, query patterns, auth boundaries, secret handling. \`(no concerns)\` is a valid answer.>
`;

const PLAN_TEMPLATE_MD = `# Implementation plan

> Coder's per-step execution plan. One commit per step; verify between
> steps; never advance while a verifier is red.

## Step 1 — <short title>

- **Files**: \`<path/to/file.ts>\`, \`<path/to/other.ts>\`
- **What changes**: <one-paragraph description of the diff>
- **Verify**: \`<command — e.g. \`pnpm --filter @atlas/api typecheck\`>\`
- **Commit**: \`<conventional-commit subject — e.g. \`feat(api): <one-liner>\`>\`

## Step 2 — <short title>

- **Files**: \`<path>\`
- **What changes**: <description>
- **Verify**: \`<command>\`
- **Commit**: \`<subject>\`

## Step N — <short title>

- **Files**: \`<path>\`
- **What changes**: <description>
- **Verify**: \`<command>\`
- **Commit**: \`<subject>\`

## Final verification

- \`pnpm typecheck\` — green across affected packages
- \`pnpm lint\` — green across affected packages
- New + modified tests cover every entry in spec.md's File-level change list
`;

const TASKS_TEMPLATE_MD = `# Tasks

> One bullet per file Coder touches. Each carries the file path + the
> verification command that proves the task is done. Mirrors spec.md's
> File-level change list — every entry there gets a task here.

- [ ] \`<path/to/file.ts>\` — <what changes>
  - Verify: \`<command — e.g. \`pnpm --filter @atlas/api exec tsc --noEmit\`>\`

- [ ] \`<path/to/other.ts>\` — <what changes>
  - Verify: \`<command>\`

- [ ] \`<path/to/test.test.ts>\` — <new / updated tests>
  - Verify: \`pnpm --filter @atlas/api test <test-file>\`
`;

const SUB_TASK_TEMPLATE_MD = `# Sub-task

## User story

As a **<user role>**, I want **<outcome>**, so that **<reason>**.

<One-paragraph capability narrative describing the user-visible behaviour end to end.>

## Acceptance criteria

- **Given** <precondition>, **when** <action>, **then** <observable outcome>.
- **Given** <precondition>, **when** <action>, **then** <observable outcome>.
- **Given** <precondition>, **when** <action>, **then** <observable outcome>.

> Three bullets minimum (happy path + two edge cases). Downstream agents
> use these lines as the test contract.
`;

// Jira-importable schema the QA Writer / QA Reviewer / Automation prompts
// and the qa-writer-csv + check-automation-tests gates all share. Labels is
// one cell of `;`-separated tags: ac-<id>, automation-yes|no, kind-<kind>.
const QA_PLAN_TEMPLATE_CSV = `Summary,Description,Issue Type,Priority,Labels,Components
"Example - replace: sign in with valid credentials","## Steps
1. Open the sign-in page
2. Submit a valid email and password

## Expected
The dashboard loads

AC: ac-1",Test,normal,ac-1;automation-yes;kind-functional,
`;

const AGENT_TEMPLATE_SEEDS: AgentTemplateSeed[] = [
    {
        id: 'spec',
        filename: 'spec.md',
        description: "Architect's spec template (6 required sections)",
        body_md: SPEC_TEMPLATE_MD,
    },
    {
        id: 'plan',
        filename: 'plan.md',
        description: "Coder's implementation plan template",
        body_md: PLAN_TEMPLATE_MD,
    },
    {
        id: 'tasks',
        filename: 'tasks.md',
        description: "Coder's per-file task breakdown",
        body_md: TASKS_TEMPLATE_MD,
    },
    {
        id: 'sub-task',
        filename: 'sub-task.md',
        description: 'PO Writer sub-task template',
        body_md: SUB_TASK_TEMPLATE_MD,
    },
    {
        id: 'qa-plan',
        filename: 'qa-plan.csv',
        description: 'QA Writer test plan CSV schema',
        body_md: QA_PLAN_TEMPLATE_CSV,
    },
];

// ─── Phase 3 — Per-agent SDLC validation scripts ─────────────────────
//
// The `guardrail_scripts` table already has a write-to-worktree
// pipeline via `constitution-assembler.ts:81-91`. The 10 rows seeded
// by migration 079 are CROSS-CUTTING checks (no-delete guard,
// secrets-in-diff, etc.) keyed by random UUID. The 6 named rows below
// are PER-AGENT validators each per-agent slash-command body invokes
// before declaring `outcome: done`. Each script takes the item id as
// `$1` (or `$args[0]` on PowerShell), exits 0 on green, or exits 1
// with a numbered gap list to stdout.
//
// Idempotency: ON CONFLICT (id) DO UPDATE. Edits to these bodies in
// future commits propagate to existing dbs on next `runSeed()`.
//
// PowerShell encoding: ASCII-only per memory
// `feedback_powershell_scripts_must_be_ascii` (PS 5.1 reads non-BOM
// UTF-8 as ANSI and parser-errors on non-ASCII). No em dashes, curly
// quotes, or arrow glyphs in any `.ps1` body.

interface GuardrailScriptSeed {
    id: string;
    name: string;
    description: string;
    sort_order: number;
    body_sh: string;
    body_ps1: string;
}

export const GUARDRAIL_SCRIPT_SEEDS: GuardrailScriptSeed[] = [
    {
        id: 'prereqs',
        name: 'Worktree prereqs',
        description:
            'Gates every agent run. Verifies the worktree is clean, the .atlas directory is staged, and the constitution lives on disk before the agent emits work.',
        sort_order: 100,
        body_sh: `#!/usr/bin/env bash
# Worktree prereqs gate. $1 is the item id (ignored here).
set -u
gaps=""
n=0
dirty="$(git status --porcelain 2>/dev/null || true)"
if [ -n "$dirty" ]; then
    n=$((n+1))
    gaps="$gaps$n. dirty working tree
"
fi
if [ ! -d .atlas ]; then
    n=$((n+1))
    gaps="$gaps$n. .atlas directory missing
"
fi
if [ ! -f .atlas/constitution.md ]; then
    n=$((n+1))
    gaps="$gaps$n. .atlas/constitution.md missing
"
fi
if [ -z "$gaps" ]; then exit 0; fi
printf "prereqs:\\n%s" "$gaps"
exit 1
`,
        body_ps1: `# Worktree prereqs gate. $args[0] is the item id (ignored here).
$ErrorActionPreference = 'Continue'
$gaps = New-Object System.Collections.ArrayList
$dirty = git status --porcelain 2>$null
if (-not [string]::IsNullOrWhiteSpace($dirty)) {
    [void]$gaps.Add('dirty working tree')
}
if (-not (Test-Path -LiteralPath '.atlas' -PathType Container)) {
    [void]$gaps.Add('.atlas directory missing')
}
if (-not (Test-Path -LiteralPath '.atlas/constitution.md' -PathType Leaf)) {
    [void]$gaps.Add('.atlas/constitution.md missing')
}
if ($gaps.Count -eq 0) { exit 0 }
Write-Output 'prereqs:'
$i = 0
foreach ($g in $gaps) { $i++; Write-Output ("{0}. {1}" -f $i, $g) }
exit 1
`,
    },
    {
        id: 'po-writer-output',
        name: 'PO Writer output check',
        description:
            "Reads the Task's sub-tasks from the Atlas API ($ATLAS_API_URL) and verifies the PO Writer contract: at least one dev sub-task, every dev sub-task labelled `dev` with non-empty acceptance_criteria, and a `<dev title> [QA]` twin labelled `qa` joined to it by a tested_by link (either direction).",
        sort_order: 101,
        body_sh: `#!/usr/bin/env bash
# PO Writer output gate. $1 is the Task id. Reads the Task's sub-tasks from the
# Atlas API at $ATLAS_API_URL (set on every agent run's env).
set -u
task="\${1:-}"
fail() { printf "po-writer-output:\\n1. %s\\n" "$1"; exit 1; }
[ -n "$task" ] || fail 'task id ($1) missing'
[ -n "\${ATLAS_API_URL:-}" ] || fail "ATLAS_API_URL is not set -- cannot read the Task's sub-tasks from the Atlas API"
api="\${ATLAS_API_URL%/}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsS "$api/api/tasks/$task/full" -o "$tmp/task.json" 2>/dev/null || fail "GET $api/api/tasks/$task/full failed"
ids="$(node -e 'for (const s of require(process.argv[1]).sub_tasks || []) console.log(s.id)' "$tmp/task.json" 2>/dev/null)"
for id in $ids; do
    curl -fsS "$api/api/issues/sub_task/$id/links" -o "$tmp/links-$id.json" 2>/dev/null || echo '[]' > "$tmp/links-$id.json"
done
node -e '
const dir = process.argv[1];
const subs = require(dir + "/task.json").sub_tasks || [];
const has = (s, l) => (s.labels || []).includes(l);
const isQa = (s) => s.title.trimEnd().endsWith("[QA]");
const gaps = [];
const dev = subs.filter((s) => !isQa(s));
if (dev.length === 0) gaps.push("no dev sub-tasks (titles not ending [QA]) under the task");
for (const d of dev) {
    if (!has(d, "dev")) gaps.push(d.id + " is missing the dev label");
    if (!(d.acceptance_criteria || "").trim()) gaps.push(d.id + " has empty acceptance_criteria");
    const twinTitle = d.title + " [QA]";
    const qa = subs.find((s) => s.title === twinTitle);
    if (!qa) {
        gaps.push(d.id + " has no [QA] twin titled " + JSON.stringify(twinTitle));
        continue;
    }
    if (!has(qa, "qa")) gaps.push(qa.id + " is missing the qa label");
    const links = require(dir + "/links-" + d.id + ".json");
    if (!links.some((l) => l.relation_type === "tested_by" && l.item_id === qa.id)) {
        gaps.push(d.id + " has no tested_by link to its [QA] twin " + qa.id);
    }
}
if (gaps.length === 0) process.exit(0);
console.log("po-writer-output:");
gaps.forEach((g, i) => console.log(i + 1 + ". " + g));
process.exit(1);
' "$tmp"
`,
        body_ps1: `# PO Writer output gate. $args[0] is the Task id. Reads the Task's sub-tasks
# from the Atlas API at $env:ATLAS_API_URL (see body_sh for the contract).
$ErrorActionPreference = 'Continue'
$task = if ($args.Count -gt 0) { $args[0] } else { '' }
function Fail([string]$msg) { Write-Output 'po-writer-output:'; Write-Output ('1. ' + $msg); exit 1 }
if ([string]::IsNullOrWhiteSpace($task)) { Fail 'task id ($args[0]) missing' }
if ([string]::IsNullOrWhiteSpace($env:ATLAS_API_URL)) { Fail "ATLAS_API_URL is not set -- cannot read the Task's sub-tasks from the Atlas API" }
$api = $env:ATLAS_API_URL.TrimEnd('/')
try { $full = Invoke-RestMethod -Uri "$api/api/tasks/$task/full" -ErrorAction Stop } catch { Fail "GET $api/api/tasks/$task/full failed" }
$subs = @()
if ($full.sub_tasks) { $subs = @($full.sub_tasks) }
$gaps = New-Object System.Collections.ArrayList
$dev = @()
foreach ($s in $subs) { if (-not "$($s.title)".TrimEnd().EndsWith('[QA]')) { $dev += $s } }
if ($dev.Count -eq 0) { [void]$gaps.Add('no dev sub-tasks (titles not ending [QA]) under the task') }
foreach ($d in $dev) {
    if (-not (@($d.labels) -contains 'dev')) { [void]$gaps.Add("$($d.id) is missing the dev label") }
    if ([string]::IsNullOrWhiteSpace($d.acceptance_criteria)) { [void]$gaps.Add("$($d.id) has empty acceptance_criteria") }
    $twinTitle = "$($d.title) [QA]"
    $qa = $null
    foreach ($s in $subs) { if ($s.title -ceq $twinTitle) { $qa = $s } }
    if ($null -eq $qa) { [void]$gaps.Add("$($d.id) has no [QA] twin titled '$twinTitle'"); continue }
    if (-not (@($qa.labels) -contains 'qa')) { [void]$gaps.Add("$($qa.id) is missing the qa label") }
    $linked = $false
    try {
        foreach ($l in (Invoke-RestMethod -Uri "$api/api/issues/sub_task/$($d.id)/links" -ErrorAction Stop)) {
            if ($l.relation_type -eq 'tested_by' -and $l.item_id -eq $qa.id) { $linked = $true }
        }
    } catch { }
    if (-not $linked) { [void]$gaps.Add("$($d.id) has no tested_by link to its [QA] twin $($qa.id)") }
}
if ($gaps.Count -eq 0) { exit 0 }
Write-Output 'po-writer-output:'
$i = 0
foreach ($g in $gaps) { $i++; Write-Output ("{0}. {1}" -f $i, $g) }
exit 1
`,
    },
    {
        id: 'architect-spec-md',
        name: 'Architect spec.md sections',
        description:
            'Verifies the architect emitted a spec.md under specs/ that carries all six required section headers.',
        sort_order: 102,
        body_sh: `#!/usr/bin/env bash
# Architect spec.md section gate. $1 is the item id (unused; located by find).
# Locates any specs/**/spec.md and verifies the six required section headers.
# Freshness vs .atlas/current-task.md is NOT checked: the harness rewrites
# current-task.md when provisioning each agent's worktree (after a Path-1
# git pull touches spec.md), which produced a deterministic race that failed
# the reviewer on a perfectly-valid spec. Existence + section coverage is
# the real gate; freshness was a brittle proxy.
set -u
gaps=""
n=0
spec=""
if [ -d specs ]; then
    spec="$(find specs -name spec.md 2>/dev/null | head -1)"
fi
if [ -z "$spec" ] || [ ! -f "$spec" ]; then
    n=$((n+1))
    gaps="$gaps$n. no specs/**/spec.md found
"
    printf "architect-spec-md:\\n%s" "$gaps"
    exit 1
fi
required="## Feasibility|## Tech stack|## Libraries to install|## File-level change list|## Test scenarios|## Performance + security"
IFS='|'
for header in $required; do
    if ! grep -qF "$header" "$spec"; then
        n=$((n+1))
        gaps="$gaps$n. spec.md missing section: $header
"
    fi
done
unset IFS
if [ -z "$gaps" ]; then exit 0; fi
printf "architect-spec-md (%s):\\n%s" "$spec" "$gaps"
exit 1
`,
        body_ps1: `# Architect spec.md section gate. $args[0] is the item id (unused).
# Locates any specs/**/spec.md and verifies the six required section headers.
# Freshness vs .atlas/current-task.md is NOT checked (see body_sh for why).
$ErrorActionPreference = 'Continue'
$spec = $null
if (Test-Path -LiteralPath 'specs' -PathType Container) {
    $candidates = Get-ChildItem -Path 'specs' -Filter 'spec.md' -Recurse -File -ErrorAction SilentlyContinue
    if ($candidates -and $candidates.Count -gt 0) { $spec = $candidates[0].FullName }
}
if ($spec -eq $null) {
    Write-Output 'architect-spec-md:'
    Write-Output '1. no specs/**/spec.md found'
    exit 1
}
$body = Get-Content -LiteralPath $spec -Raw
$required = @('## Feasibility','## Tech stack','## Libraries to install','## File-level change list','## Test scenarios','## Performance + security')
$gaps = @()
foreach ($h in $required) {
    if (-not $body.Contains($h)) { $gaps += "spec.md missing section: $h" }
}
if ($gaps.Count -eq 0) { exit 0 }
Write-Output ("architect-spec-md ({0}):" -f $spec)
$i = 0
foreach ($g in $gaps) { $i++; Write-Output ("{0}. {1}" -f $i, $g) }
exit 1
`,
    },
    {
        id: 'coder-tests-green',
        name: 'Coder typecheck/lint/tests changed',
        description:
            "Coder gate: the project's own typecheck and lint scripts (run only when package.json declares them, via the package manager its lockfile implies) must exit 0, and the diff against origin/main (or HEAD~10) must add or modify at least one test file (*.test|spec.{js,ts,jsx,tsx,mjs,cjs}, *_test.go, test_*.py). With `--run-tests` as the second argument (Code Reviewer) the declared `test` script must pass too.",
        sort_order: 103,
        body_sh: `#!/usr/bin/env bash
# Coder gate. $1 is the item id (unused). $2 = --run-tests also runs the
# project's test script (Code Reviewer owns the full suite; Coder skips it).
# Project-agnostic: scripts run only if package.json declares them, with
# the package manager the lockfile implies.
set -u
checks="typecheck lint"
[ "\${2:-}" = "--run-tests" ] && checks="$checks test"
gaps=""
n=0
pm=npm
[ -f pnpm-lock.yaml ] && pm=pnpm
[ -f yarn.lock ] && pm=yarn
has_script() {
    [ -f package.json ] && node -e "process.exit((require('./package.json').scripts || {})['$1'] ? 0 : 1)" 2>/dev/null
}
for s in $checks; do
    if has_script "$s" && ! "$pm" run "$s" >/dev/null 2>&1; then
        n=$((n+1))
        gaps="$gaps$n. $s failed
"
    fi
done
base="$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD~10)"
changed_tests="$(git diff --name-only "$base" HEAD 2>/dev/null | grep -E '(\\.(test|spec)\\.[cm]?[jt]sx?$)|(_test\\.go$)|((^|/)test_[^/]*\\.py$)' || true)"
if [ -z "$changed_tests" ]; then
    n=$((n+1))
    gaps="$gaps$n. no test files added/modified
"
fi
if [ -z "$gaps" ]; then exit 0; fi
printf "coder-tests-green:\\n%s" "$gaps"
exit 1
`,
        body_ps1: `# Coder gate. $args[0] is the item id (unused). $args[1] = --run-tests also
# runs the project's test script (Code Reviewer owns the full suite).
$ErrorActionPreference = 'Continue'
$gaps = New-Object System.Collections.ArrayList
$pm = 'npm'
if (Test-Path 'pnpm-lock.yaml') { $pm = 'pnpm' }
if (Test-Path 'yarn.lock') { $pm = 'yarn' }
$scripts = $null
if (Test-Path 'package.json') {
    try { $scripts = (Get-Content -Raw 'package.json' | ConvertFrom-Json).scripts } catch { $scripts = $null }
}
$checks = @('typecheck', 'lint')
if ($args.Count -gt 1 -and $args[1] -eq '--run-tests') { $checks += 'test' }
foreach ($s in $checks) {
    if ($scripts -and ($scripts.PSObject.Properties.Name -contains $s)) {
        & $pm run $s 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { [void]$gaps.Add("$s failed") }
    }
}
$base = git merge-base HEAD origin/main 2>$null
if ([string]::IsNullOrWhiteSpace($base)) { $base = 'HEAD~10' }
$changed = git diff --name-only $base HEAD 2>$null
$tests = @()
if (-not [string]::IsNullOrWhiteSpace($changed)) {
    foreach ($line in ($changed -split "\`r?\`n")) {
        if ($line -match '(\\.(test|spec)\\.[cm]?[jt]sx?$)|(_test\\.go$)|((^|/)test_[^/]*\\.py$)') { $tests += $line }
    }
}
if ($tests.Count -eq 0) { [void]$gaps.Add('no test files added/modified') }
if ($gaps.Count -eq 0) { exit 0 }
Write-Output 'coder-tests-green:'
$i = 0
foreach ($g in $gaps) { $i++; Write-Output ("{0}. {1}" -f $i, $g) }
exit 1
`,
    },
    {
        id: 'qa-writer-csv',
        name: 'QA Writer test-plan CSV',
        description:
            'QA Writer gate: tests/qa/<itemId>.csv must exist, carry the Jira-importable header `Summary,Description,Issue Type,Priority,Labels,Components`, contain at least one body row, and be touched by the HEAD commit.',
        sort_order: 104,
        body_sh: `#!/usr/bin/env bash
# QA Writer gate. $1 is the QA sub-task id.
set -u
item="\${1:-}"
expected_header="Summary,Description,Issue Type,Priority,Labels,Components"
gaps=""
n=0
if [ -z "$item" ]; then
    printf "qa-writer-csv:\\n1. item id (\\$1) missing\\n"
    exit 1
fi
csv="tests/qa/\${item}.csv"
if [ ! -f "$csv" ]; then
    printf "qa-writer-csv:\\n1. %s missing\\n" "$csv"
    exit 1
fi
header="$(head -n 1 "$csv" | tr -d '\\r')"
if [ "$header" != "$expected_header" ]; then
    n=$((n+1))
    gaps="$gaps$n. header mismatch (got: $header)
"
fi
# Rows can span lines (quoted Description), so count non-blank content, not lines.
if ! tail -n +2 "$csv" | grep -q '[^[:space:]]'; then
    n=$((n+1))
    gaps="$gaps$n. no test rows
"
fi
# F-006 -- assert HEAD commit touched the CSV. Catches agents that
# claim "I committed N cases" while the CSV is unchanged from a
# prior run. Best-effort; swallow git failures so the primary
# header / row-count gates still surface clearly.
if command -v git >/dev/null 2>&1; then
    head_files="$(git log -1 --name-only --format= HEAD 2>/dev/null | grep -v '^$' || true)"
    if [ -n "$head_files" ] && ! printf "%s\\n" "$head_files" | grep -Fxq "$csv"; then
        n=$((n+1))
        gaps="$gaps$n. HEAD commit does not touch $csv -- did the agent actually commit its change?
"
    fi
fi
if [ -z "$gaps" ]; then exit 0; fi
printf "qa-writer-csv (%s):\\n%s" "$csv" "$gaps"
exit 1
`,
        body_ps1: `# QA Writer gate. $args[0] is the QA sub-task id.
$ErrorActionPreference = 'Continue'
$item = if ($args.Count -gt 0) { $args[0] } else { '' }
$expected = 'Summary,Description,Issue Type,Priority,Labels,Components'
$gaps = New-Object System.Collections.ArrayList
if ([string]::IsNullOrWhiteSpace($item)) {
    Write-Output 'qa-writer-csv:'
    Write-Output '1. item id ($args[0]) missing'
    exit 1
}
$csv = "tests/qa/$item.csv"
if (-not (Test-Path -LiteralPath $csv -PathType Leaf)) {
    Write-Output 'qa-writer-csv:'
    Write-Output ("1. {0} missing" -f $csv)
    exit 1
}
$lines = Get-Content -LiteralPath $csv
$header = if ($lines.Count -gt 0) { $lines[0].TrimEnd("\`r") } else { '' }
if ($header -ne $expected) {
    [void]$gaps.Add("header mismatch (got: $header)")
}
$rows = @($lines | Select-Object -Skip 1 | Where-Object { $_ -match '\\S' })
if ($rows.Count -eq 0) { [void]$gaps.Add('no test rows') }
# F-006 -- assert HEAD commit touched the CSV. Catches the case where
# the agent claims "I committed N cases" but the CSV is unchanged
# from a previous run. If the latest commit's name-only output lists
# the CSV path, the current run actually touched it; if not, the
# agent's "what I did" is a hallucination.
try {
    $headFiles = (git log -1 --name-only --format= HEAD 2>$null) -split "\`n" | Where-Object { $_ -match '\\S' }
    if (-not ($headFiles -contains $csv)) {
        [void]$gaps.Add("HEAD commit does not touch $csv -- did the agent actually commit its change?")
    }
} catch {
    # If git itself fails, this gate is best-effort; don't block the
    # primary validators.
}
if ($gaps.Count -eq 0) { exit 0 }
Write-Output ("qa-writer-csv ({0}):" -f $csv)
$i = 0
foreach ($g in $gaps) { $i++; Write-Output ("{0}. {1}" -f $i, $g) }
exit 1
`,
    },
    {
        id: 'check-automation-tests',
        name: 'Automation Engineer test coverage (CSV automation-yes rows)',
        description:
            'Automation Engineer gate: tests/qa/<itemId>.csv must exist; for every row whose Labels carry `automation-yes`, a test file added or modified between merge-base and HEAD (*.test|spec.{js,ts,jsx,tsx,mjs,cjs}, *_test.go, test_*.py) must contain the row Summary. The CSV is parsed RFC-4180 (quoted cells may hold commas and newlines).',
        sort_order: 105,
        body_sh: `#!/usr/bin/env bash
# Automation Engineer gate. $1 is the QA sub-task id.
set -u
item="\${1:-}"
if [ -z "$item" ]; then
    printf "check-automation-tests:\\n1. item id (\\$1) missing\\n"
    exit 1
fi
csv="tests/qa/\${item}.csv"
if [ ! -f "$csv" ]; then
    printf "check-automation-tests:\\n1. %s missing\\n" "$csv"
    exit 1
fi
base="$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD~10)"
test_files="$(git diff --name-only "$base" HEAD 2>/dev/null | grep -E '(\\.(test|spec)\\.[cm]?[jt]sx?$)|(_test\\.go$)|((^|/)test_[^/]*\\.py$)' || true)"
TEST_FILES="$test_files" node -e '
const fs = require("fs");
const csv = process.argv[1];
const text = fs.readFileSync(csv, "utf8");
const Q = String.fromCharCode(34);
const rows = [];
let row = [], cell = "", quoted = false;
for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
        if (c !== Q) cell += c;
        else if (text[i + 1] === Q) { cell += Q; i++; }
        else quoted = false;
    } else if (c === Q) quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\\r") cell += c;
}
if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
const header = rows.shift() || [];
const si = header.indexOf("Summary");
const li = header.indexOf("Labels");
const gaps = [];
if (si < 0 || li < 0) gaps.push("header lacks Summary / Labels columns");
const bodies = (process.env.TEST_FILES || "").split("\\n").filter((f) => f && fs.existsSync(f)).map((f) => fs.readFileSync(f, "utf8"));
for (const r of si < 0 || li < 0 ? [] : rows) {
    if (!(r[li] || "").split(";").map((l) => l.trim()).includes("automation-yes")) continue;
    const summary = (r[si] || "").trim();
    if (!summary || !bodies.some((b) => b.includes(summary))) {
        gaps.push("automation-yes row " + JSON.stringify(summary) + " has no changed test file containing its Summary");
    }
}
if (gaps.length === 0) process.exit(0);
console.log("check-automation-tests (" + csv + "):");
gaps.forEach((g, i) => console.log(i + 1 + ". " + g));
process.exit(1);
' "$csv"
`,
        body_ps1: `# Automation Engineer gate. $args[0] is the QA sub-task id.
$ErrorActionPreference = 'Continue'
$item = if ($args.Count -gt 0) { $args[0] } else { '' }
if ([string]::IsNullOrWhiteSpace($item)) {
    Write-Output 'check-automation-tests:'
    Write-Output '1. item id ($args[0]) missing'
    exit 1
}
$csv = "tests/qa/$item.csv"
if (-not (Test-Path -LiteralPath $csv -PathType Leaf)) {
    Write-Output 'check-automation-tests:'
    Write-Output ("1. {0} missing" -f $csv)
    exit 1
}
$base = git merge-base HEAD origin/main 2>$null
if ([string]::IsNullOrWhiteSpace($base)) { $base = 'HEAD~10' }
$changed = git diff --name-only $base HEAD 2>$null
$bodies = @()
if (-not [string]::IsNullOrWhiteSpace($changed)) {
    foreach ($line in ($changed -split "\`r?\`n")) {
        if ($line -match '(\\.(test|spec)\\.[cm]?[jt]sx?$)|(_test\\.go$)|((^|/)test_[^/]*\\.py$)' -and (Test-Path -LiteralPath $line -PathType Leaf)) {
            $bodies += "$(Get-Content -LiteralPath $line -Raw)"
        }
    }
}
$gaps = New-Object System.Collections.ArrayList
$header = @((Get-Content -LiteralPath $csv -TotalCount 1) -split ',' | ForEach-Object { $_.Trim('"') })
if (($header -notcontains 'Summary') -or ($header -notcontains 'Labels')) {
    [void]$gaps.Add('header lacks Summary / Labels columns')
} else {
    # Import-Csv is RFC-4180: quoted cells may carry commas and newlines.
    foreach ($row in (Import-Csv -LiteralPath $csv)) {
        $labels = @("$($row.Labels)" -split ';' | ForEach-Object { $_.Trim() })
        if ($labels -notcontains 'automation-yes') { continue }
        $summary = "$($row.Summary)".Trim()
        $found = $false
        foreach ($b in $bodies) { if ($summary -and $b.Contains($summary)) { $found = $true; break } }
        if (-not $found) { [void]$gaps.Add("automation-yes row '$summary' has no changed test file containing its Summary") }
    }
}
if ($gaps.Count -eq 0) { exit 0 }
Write-Output ("check-automation-tests ({0}):" -f $csv)
$i = 0
foreach ($g in $gaps) { $i++; Write-Output ("{0}. {1}" -f $i, $g) }
exit 1
`,
    },
    {
        id: 'commit-discipline',
        name: 'Commit discipline (Co-Authored-By trailer)',
        description:
            'Every commit between git merge-base HEAD origin/main and HEAD must carry the Co-Authored-By trailer in its body. Catches commits made without the standard human+AI signature.',
        sort_order: 106,
        body_sh: `#!/usr/bin/env bash
# Commit discipline gate. $1 is the item id (unused).
set -u
base="$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD~10)"
shas="$(git log --format=%H "$base"..HEAD 2>/dev/null || true)"
if [ -z "$shas" ]; then exit 0; fi
gaps=""
n=0
for sha in $shas; do
    body="$(git log -1 --format=%B "$sha" 2>/dev/null || true)"
    if ! printf "%s" "$body" | grep -q "Co-Authored-By:"; then
        n=$((n+1))
        gaps="$gaps$n. commit $sha missing Co-Authored-By trailer
"
    fi
done
if [ -z "$gaps" ]; then exit 0; fi
printf "commit-discipline:\\n%s" "$gaps"
exit 1
`,
        body_ps1: `# Commit discipline gate. $args[0] is the item id (unused).
$ErrorActionPreference = 'Continue'
$base = git merge-base HEAD origin/main 2>$null
if ([string]::IsNullOrWhiteSpace($base)) { $base = 'HEAD~10' }
$shas = git log --format=%H "$base..HEAD" 2>$null
if ([string]::IsNullOrWhiteSpace($shas)) { exit 0 }
$gaps = New-Object System.Collections.ArrayList
foreach ($sha in ($shas -split "\`r?\`n")) {
    if ([string]::IsNullOrWhiteSpace($sha)) { continue }
    $body = git log -1 --format=%B $sha 2>$null
    if (-not ($body -match 'Co-Authored-By:')) {
        [void]$gaps.Add("commit $sha missing Co-Authored-By trailer")
    }
}
if ($gaps.Count -eq 0) { exit 0 }
Write-Output 'commit-discipline:'
$i = 0
foreach ($g in $gaps) { $i++; Write-Output ("{0}. {1}" -f $i, $g) }
exit 1
`,
    },
];

async function seedGuardrailScripts(): Promise<void> {
    const now = new Date().toISOString();
    for (const s of GUARDRAIL_SCRIPT_SEEDS) {
        await db
            .insertInto('guardrail_scripts')
            .values({
                id: s.id,
                name: s.name,
                description: s.description,
                body_sh: s.body_sh,
                body_ps1: s.body_ps1,
                sort_order: s.sort_order,
            })
            .onConflict((oc) =>
                oc.column('id').doUpdateSet({
                    name: s.name,
                    description: s.description,
                    body_sh: s.body_sh,
                    body_ps1: s.body_ps1,
                    sort_order: s.sort_order,
                    updated_at: now,
                }),
            )
            .execute();
    }
}

async function seedAgentTemplates(): Promise<void> {
    const now = new Date().toISOString();
    // ADR 0015 renamed the PO Writer template; drop the old row so worktrees
    // stop getting a stale `story.md`.
    await db.deleteFrom('agent_templates').where('id', '=', 'story').execute();
    for (const tpl of AGENT_TEMPLATE_SEEDS) {
        await db
            .insertInto('agent_templates')
            .values({
                id: tpl.id,
                filename: tpl.filename,
                description: tpl.description,
                body_md: tpl.body_md,
                created_at: now,
                updated_at: now,
            })
            .onConflict((oc) =>
                oc.column('id').doUpdateSet({
                    filename: tpl.filename,
                    description: tpl.description,
                    body_md: tpl.body_md,
                    updated_at: now,
                }),
            )
            .execute();
    }
}

// `runSeed` is the single entry point for `pnpm db:seed`. It does ONE thing:
// sync the on-disk catalog (`packages/api/src/marketplace/catalog/`) into the
// `marketplace_agents` table. Idempotent — each entry's `version` is taken
// verbatim from its `manifest.json` and overwritten on every run; content_hash
// is stored but does not drive it.
//
// It NEVER creates rows in the `agents` table. Agents exist only when the
// Owner installs them via `POST /api/marketplace/agents/:id/install`
// (`marketplaceService.install`). The earlier auto-install-on-boot path
// resurrected agents the Owner had deleted — see
// `.claude/plans/there-is-a-problem-zazzy-rivest.md`. Per-boot reconciliation
// of seed-shaped prompts on agents the Owner did install lives in
// `services/agent-defaults-sync.ts`.
export async function runSeed(): Promise<void> {
    assertRegulationsMatrixHealthy();

    const catalog = await syncMarketplaceCatalog();

    // Phase 2 — seed the five artifact templates so the templates-
    // assembler has rows to write per run. Idempotent via ON CONFLICT.
    await seedAgentTemplates();

    // Phase 3 — seed the 6 per-agent SDLC validation scripts so the
    // existing constitution-assembler pipeline writes them to
    // `.atlas/scripts/{bash,powershell}/check-<id>.{sh,ps1}` per
    // worktree. Idempotent via ON CONFLICT.
    await seedGuardrailScripts();

    console.log(
        `[db] seed: marketplace catalog synced (${catalog.length} entries) + ${GUARDRAIL_SCRIPT_SEEDS.length} guardrail scripts`
    );
}
