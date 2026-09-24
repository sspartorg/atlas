# Agent scorecard — 2026-09-24T05-56-34-882Z-v1-full-golden-set

12 workflow run(s) · 203 agent dispatch(es) · $94.2322 · 245 min of agent time · 2/49 gate verdicts red

## Per agent

| Agent | Steps | pass@1 | Loops | Escalations | Gate catches | $ | $/step | Cache read | Model(s) | Effort(s) |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|---|
| `agent-po-writer` | 12 | 0% | 12 | 13 | 0 | 16.32 | 1.36 | 100% | claude-opus-5 | high |
| `agent-coder` | 18 | 94% | 2 | 1 | 0 | 6.19 | 0.34 | 100% | claude-sonnet-5 | high |
| `agent-code-reviewer` | 17 | 94% | 1 | 0 | 0 | 2.80 | 0.16 | 100% | claude-sonnet-5 | medium |
| `agent-qa-writer` | 17 | 94% | 0 | 0 | 0 | 5.92 | 0.35 | 100% | claude-sonnet-5 | medium |
| `agent-doc-writer` | 15 | 93% | 2 | 1 | 0 | 3.24 | 0.22 | 100% | claude-sonnet-5 | low |
| `agent-qa-reviewer` | 16 | 100% | 0 | 0 | 0 | 4.51 | 0.28 | 100% | claude-sonnet-5 | high |
| `agent-automation` | 16 | 100% | 0 | 0 | 0 | 5.58 | 0.35 | 100% | claude-sonnet-5 | medium |
| `agent-automation-reviewer` | 16 | 100% | 0 | 0 | 0 | 3.01 | 0.19 | 100% | claude-sonnet-5 | medium |
| `agent-doc-reviewer` | 15 | 93% | 1 | 0 | 2 | 2.91 | 0.19 | 100% | claude-sonnet-5 | low |
| `agent-po-reviewer` | 11 | 100% | 0 | 0 | 0 | 1.95 | 0.18 | 100% | claude-sonnet-5 | medium |
| `agent-architect` | 11 | 100% | 0 | 0 | 0 | 22.01 | 2.00 | 100% | claude-opus-5[1m] | high |
| `agent-architect-reviewer` | 11 | 100% | 0 | 0 | 0 | 1.88 | 0.17 | 100% | claude-sonnet-5 | medium |
| `agent-release-reviewer` | 8 | 75% | 0 | 0 | 0 | 17.50 | 2.19 | 100% | claude-opus-5[1m] | xhigh |
| `agent-hygiene-fixer` | 2 | 50% | 0 | 1 | 0 | 0.42 | 0.21 | 100% | claude-sonnet-5 | medium |

`pass@1` is the share of step positions whose **first** dispatch routed pass. `Gate catches` counts deterministic gate failures that landed after this agent was the last to report `done` — the one quality signal an agent cannot author itself.

**Read `agent-po-writer` differently.** Its prompt makes run 1 a brainstorm pass that always ends `asked_question`, so a low pass@1 and a high escalation count are the design working, not the agent failing. Judge it on whether the Owner had to answer more than once, i.e. escalations above one per run.

## Per run

| Run | Item | Status | Dispatches | $ | Wall clock | Loops | Gates |
|---|---|---|--:|--:|--:|--:|---|
| `8e189701` | ATL-25 | waiting_for_owner | 1 | 0.5422 | 0m | 0 | — |
| `9222e822` | ATL-26 | completed | 14 | 6.9244 | 20m | 0 | gate-hygiene:pass, gate-coverage:pass, gate-perf:pass, gate-visual:pass, coder-tests-green:pass |
| `b3849de2` | ATL-27 | completed | 22 | 11.8079 | 33m | 0 | gate-hygiene:pass, gate-hygiene:pass, gate-coverage:pass, gate-coverage:pass, gate-perf:pass, gate-perf:pass, gate-visual:pass, gate-visual:pass, coder-tests-green:pass, coder-tests-green:pass |
| `6c677a6c` | ATL-28 | completed | 22 | 9.9416 | 27m | 0 | gate-hygiene:pass, gate-coverage:pass, gate-perf:pass, gate-visual:pass, coder-tests-green:pass |
| `4170a3ea` | ATL-38 | waiting_for_owner | 7 | 4.0666 | 0m | 0 | — |
| `306ea6f1` | ATL-39 | completed | 16 | 7.156 | 20m | 0 | gate-hygiene:pass, gate-coverage:pass, gate-perf:pass, gate-visual:pass, coder-tests-green:pass |
| `8fd6b44e` | ATL-49 | completed | 15 | 7.7334 | 24m | 0 | gate-hygiene:pass, gate-coverage:pass, gate-perf:pass, gate-visual:pass, coder-tests-green:pass |
| `60ef7281` | ATL-50 | waiting_for_owner | 30 | 11.5094 | 0m | 1 | gate-hygiene:fail |
| `223749df` | ATL-51 | waiting_for_owner | 14 | 5.6456 | 0m | 0 | — |
| `150b4cb3` | ATL-67 | waiting_for_owner | 34 | 16.7902 | 0m | 2 | gate-hygiene:fail, gate-hygiene:pass, gate-hygiene:pass, gate-coverage:pass, gate-coverage:pass, gate-perf:pass, gate-perf:pass, gate-visual:pass, gate-visual:pass |
| `3dcefdd5` | ATL-68 | completed | 14 | 6.1086 | 21m | 0 | gate-hygiene:pass, gate-coverage:pass, gate-perf:pass, gate-visual:pass, coder-tests-green:pass |
| `3805e7dc` | ATL-75 | waiting_for_owner | 14 | 6.0063 | 0m | 1 | gate-hygiene:pass, gate-coverage:pass, gate-perf:pass, gate-visual:pass |
