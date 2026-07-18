# 0007. Marketplace-Only Install Path

**Date:** 2026-06-04
**Status:** Accepted

## Context

Atlas ships a curated catalog of agents under `packages/api/src/marketplace/catalog/`. Each catalog entry is a directory with a `manifest.json` and the prompt bodies (`prompt.md`, `reviewer_prompt.md` where applicable). The catalog is the canonical declaration of which agents are *available* to the Owner.

The original boot flow auto-installed every catalog entry into the `agents` table on startup. If the Owner deleted an agent, the next `runSeed()` call would resurrect it on the next boot. The pushback documented in the Owner memory `[[project_marketplace_install_only]]` and in `packages/api/src/db/seed.ts:1449-1460` makes the problem concrete: the marketplace is supposed to be the single contract surface for what lands on the workspace; auto-install bypassed it and created drift between catalog state ("available") and installed state ("on this Owner's workspace"). The fix landed in commit `8ab8b8f fix(seed): never auto-install catalog entries into the agents table` on 2026-06-04.

The current contract is explicit: catalog is one thing, installed is another. The Owner installs by clicking through the marketplace UI, which posts to `POST /api/marketplace/agents/:id/install`, which calls `marketplaceService.install` and writes a single row to `agents`. Deletion is a one-way door — the catalog row remains, but the Owner's installed copy is gone until they choose to re-install.

## Decision

`runSeed()` MUST NOT touch the `agents` table. Its only responsibility is to sync the on-disk catalog into the `marketplace_agents` table (idempotent, content-hash-driven for version bumps) and to seed the artifact templates. Agent installation goes through exactly one path: the Owner clicks Install in the marketplace UI, which hits `POST /api/marketplace/agents/:id/install`. There is no auto-install on boot, no top-up of "missing" defaults, no resurrection of deleted agents.

Per-boot reconciliation of seed-shaped prompt content on agents the Owner did install lives in `services/agent-defaults-sync.ts` — that path only touches rows the Owner explicitly created via the marketplace.

## Consequences

- Deleted agents stay deleted. The Owner's workspace state is authoritative; the catalog does not override it.
- The marketplace is the single, auditable surface for "what agents land on this Owner's workspace." Every install corresponds to one Owner click.
- A fresh workspace has zero agents until the Owner installs from the marketplace. The empty-state CTA in the Agents page now points at the marketplace (commit `6db843d fix(agents): empty-state CTA navigates to marketplace, drop restore-defaults`).
- Bulk-install / restore-defaults is gone as a feature. An Owner who wants every catalog agent must install each one.
- Tests of agent behavior must explicitly install fixture agents — none are auto-present.
- The catalog can evolve (new agents added, prompts updated) without disturbing any Owner who has not opted in.
