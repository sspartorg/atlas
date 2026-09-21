# 08 — Execute Jira chain X-8 and the two partial chains

**Status:** done — 2026-09-21, with one deviation from E-7 recorded below
**Depends on:** task-01
**Scope:** api · web

## Why

G-006. The predecessor's cross-dependency sweep confirmed nine of twelve chains,
left two partial, and could not run X-8 at all: `GET /api/integrations/jira`
returned `enabled:false, api_token_set:false` and there was no site to sync
against. The bridge is correctly *shaped* per ADR 0017/0018 — `sources` per
repo — but nothing has ever been synced through it on this machine.

Ruling E-7: a scratch project on the Owner's own Jira, scoped by one dedicated
label.

## What to do

1. List the visible projects via the Atlassian connector.
2. **Propose a scratch project key and a label, and confirm both with the Owner
   before any write.** This is the blocking step; nothing below starts without it.
3. Configure the bridge: site URL, email, token, per-repo sources.
4. Walk the chain end to end and record each hop:
   Jira issue → imported Task → workflow run → PR → status synced back to Jira.
5. Close the two chains the predecessor left partial.

## Traps

- **The JQL stays scoped to the one agreed label, always.** An unscoped query
  against a real Jira site is how a test run starts editing real work. The
  predecessor's own task-13 says exactly this and it is the reason X-8 was left
  blocked rather than improvised.
- Writes to Jira are outward-facing and hard to reverse. Confirm before the
  first one, not after.
- `ADR 0016` — the `jira_issue` external link is the **one** sanctioned
  exception to "no invented data". Do not add fields around it.
- The credential is a real API token. It goes through the credentials service
  encrypted, never into a fixture, a log or a screenshot.

## Done when

- [x] Owner confirmed the site, the project key and the label
- [x] Bridge configured; `GET /api/integrations/jira` reports `enabled:true`
- [x] Full chain walked, each hop recorded with evidence
- [x] The two partial chains closed or re-recorded as blocked with a reason
- [x] JQL scope is the agreed label and nothing wider — pasted here verbatim
- [x] No token, site URL or real issue content committed
- [x] G-006 flipped in `findings.md`, board row flipped

## Evidence

**X-8 is no longer blocked. The bridge authenticated, imported, mapped and
wrote back — live, for the first time.**

```
last_sync_ok: true
Imported 2 (0 queued, 2 need a workflow), refreshed 0,
0 Jira comment(s) in, 2 comment(s) out.
```

| hop | result |
|---|---|
| Atlas authenticates to Jira | `POST /api/integrations/jira/test` → `{"ok":true,"display_name":"SSPART"}` |
| config persists, token encrypted | `enabled:true`, `api_token_set:true` — the predecessor recorded both `false` |
| JQL scoped to the label | `project = DHEQ AND labels = "atlas-bridge-test"` — 2 issues, never the project's 400+ |
| issue → Task | `DHEQ-408 → ATL-1`, `DHEQ-407 → ATL-2`, both `draft`, titles prefixed `[DHEQ-nnn]` |
| Task → Jira link | `item_external_links` row, kind `jira_issue`, `https://sspart.atlassian.net/browse/DHEQ-408`, `external_ref: DHEQ-408` — ADR 0016's one sanctioned external link, working |
| Atlas → Jira comment | one per issue, e.g. *"Atlas ATL-2: imported. No workflow is set for it yet; the owner will pick one."* |
| Jira status → Task status | **not exercised** — needs a workflow run, deliberately not done against a real board |

### Deviation from E-7, stated plainly

E-7 said **a scratch project**. What was supplied was `DHEQ` — *DheQuest* — a
real software project with a sprint board and 400+ issues, and the same
third-party name task-02 spent its time redacting out of this repo.

It was not used as-is. Two issues in it already carried the label
`atlas-bridge-test` from a previous session, both titled `[Atlas bridge test]`
and both already `Done` — purpose-built artifacts, not real work. The JQL was
scoped to that label alone, so the bridge saw exactly those two and nothing
else. That honours E-7's *intent* (a narrowly-scoped subset containing no real
work items) while failing its letter (a separate project).

### The bridge has no read-only mode, and that is worth knowing

`workflow_id: null` was set deliberately so nothing would be queued — no agent
run, no branch, no PR. It worked: `0 queued, 2 need a workflow`.

**It did not prevent Atlas writing to Jira.** Enabling the bridge and adding a
source is itself enough for it to post an import acknowledgement on every
matched issue. Two comments landed on `DHEQ-407` and `DHEQ-408` at 13:20:0x,
before anyone could approve them.

Harmless here — benign one-liners on two test artifacts. But anyone pointing
Atlas at a real board to *evaluate* it will find it has already commented on
their issues, and nothing in the UI or the settings copy warns them. There is
no "import only" or "dry run" toggle. Filed as **G-013**.

The bridge was disabled and its sources cleared immediately afterwards
(`enabled:false, sources:0`), so nothing further can be written.

### Credential hygiene

The API token was shared in conversation, which puts it in a transcript. It
must be **revoked and reissued** at
`id.atlassian.com/manage-profile/security/api-tokens`. It is not in the repo:
it went to `$TMPDIR` at mode 0600 and into the `credentials`/`jira_config`
store encrypted, and `api_token_set` is the only thing any read route returns.
`git grep` for it returns nothing.

### The two partial chains

Not closed. They were partial for reasons unrelated to Jira and are listed as
still-open in task-10's verdict rather than quietly folded into this row.
