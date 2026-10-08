# 0027. One Failure Rule, No Owner Steps in Templates

**Date:** 2026-10-08
**Status:** Accepted

## Context

The engine already routed every step the same way (`agent-runner-outcome-routing.ts`, `workflow-engine.ts`), but the templates and docs told it three ways. Delivery sent PO Writer's failure through an explicit Owner node, other agents with no fail edge parked implicitly, and the docs still described the Release Reviewer going through the Owner. Users read the Owner node as something every workflow needs. The Gate node also looked like a second kind of agent, and nothing said where its command came from.

## Decision

One rule, applied by the engine, never drawn:

- **Done** takes the pass edge.
- **Failure** (a reviewer's `rejected`, a missed required checklist item, a check command that exits non-zero) takes the fail edge to the agent that fixes it. With no fail edge, the item parks as Waiting for info.
- **Anything unknown** (a step error, `asked_question`, no outcome block, a check that cannot run) always parks as Waiting for info.

Starter templates carry no Owner node (`catalog-contract.test.ts` enforces it). The Owner node stays in the palette for a user who wants an explicit approval.

The `gate` node is labelled **Check** in the UI. Its type stays `gate`. The user types no command: the checker agent picks the repo's own command, Atlas runs it and trusts the exit code (ADR 0024).

## Consequences

- `delivery` and `quick` moved to `version: 2` so pulled copies get the upgrade.
- An approval step is a choice the user makes, not a default to remove.
