# 08 — Execute Jira chain X-8 and the two partial chains

**Status:** todo — blocked on the Owner naming a site and project key (E-7)
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

- [ ] Owner confirmed the site, the project key and the label
- [ ] Bridge configured; `GET /api/integrations/jira` reports `enabled:true`
- [ ] Full chain walked, each hop recorded with evidence
- [ ] The two partial chains closed or re-recorded as blocked with a reason
- [ ] JQL scope is the agreed label and nothing wider — pasted here verbatim
- [ ] No token, site URL or real issue content committed
- [ ] G-006 flipped in `findings.md`, board row flipped

## Evidence

_Written after execution._
