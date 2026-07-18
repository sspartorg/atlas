# 0010. Prompt MD over Structured Config

**Date:** 2026-05-27
**Status:** Accepted

## Context

Atlas's agents have two distinct configuration surfaces. One drives non-LLM behavior: the CLI choice (`claude` / `copilot`), the model name, the schedule cadence, the concurrency cap, the role assignment, the handoff rules. The other drives LLM behavior: what prompt the agent runs against, what voice it speaks in, how it interprets escalations, what its course-correction memory looks like.

An early iteration of the runtime tried to model LLM behavior with structured config: per-kind Zod schemas in `@atlas/shared`, per-kind UI forms in the web app (the "AutonomousSettingsTab" and per-agent settings panels), and a per-kind `settings_json` column on the `agents` row validated against the corresponding schema. The intuition was that structured fields would constrain the Owner to valid configurations and make agent behavior more legible at a glance.

The Owner pushback was sharp and consistent (see `[[feedback_prompt_over_structured_config]]` and `[[project_autonomous_tab_ripout]]`): structured fields sprawled into six-plus per-kind schemas with marginal value over what the prompt itself could express. Every new agent behavior nudge required a new schema field, a new form input, a new validation rule, and a new place for the runner to read the value — when the same nudge could have been one sentence added to the prompt body. The Owner prefers to steer agent behavior in prose, in one place (`agents.prompt_md`), rather than tweak UI knobs scattered across multiple tabs.

The rip-out shipped on 2026-05-27 (memory `[[project_autonomous_tab_ripout]]`): `AutonomousSettingsTab` was deleted, the per-kind Zod schemas were deleted, and `PATCH /api/agents/:id` no longer validates `settings_json`, `cron_expr`, or `kind_slug`. Per-agent plans A09 / A10 / A14 / C06 / C07 followed the same teardown for their respective surfaces.

## Decision

Agent LLM behavior lives exclusively in `agents.prompt_md` (the performer persona) and `agents.reviewer_prompt_md` (the reviewer persona, where applicable). Both are free-form markdown blobs. Structured config columns on the agent row are reserved for non-LLM consumers only — the runner (CLI / model / framework), the scheduler (cadence / concurrency), the dispatcher (handoff rules / role), and the constitution machinery (project guardrails). No new structured fields may be introduced to steer LLM behavior; that work goes into prompt text.

## Consequences

- New agent behaviors land in prompt text, fast. The Owner edits one markdown file in the Prompt tab and the next dispatch sees the change.
- Per-kind UI forms and per-kind Zod schemas for LLM-facing settings are forbidden going forward. The Autonomous Settings Tab is gone and is not coming back.
- Agent behavior is less discoverable by skimming UI knobs. The Owner must read the prompt to know what an agent does — but the prompt is the source of truth, so reading it is correct.
- Structured config remains valid for non-LLM consumers. The scheduler still needs `schedule_hours`; the runner still needs `cli` and `model`. Those columns are not free-form.
- The `prompt_md` body is now the single highest-leverage edit on an agent. Prompt versioning (`agent_prompt_versions`) and the revert flow exist because of this — losing a working prompt would be catastrophic.
- Migrations may drop legacy structured fields as the rip-out completes; consumers of those fields must move into the prompt.
