# 0029. One Task at a Time per Repo, Idempotent Resume, No Git-History Tests

**Date:** 2026-10-11
**Status:** Accepted

## Context

Apple Shop ran five Tasks in parallel on one repo. Each branch changed the same few files, so the pull requests could not merge with each other, and each needed a hand-merged replacement. Atlas does not rebase a branch onto a moved `main`; a conflict parks the run.

Three smaller problems came up in the same run:

- Resuming a run that a comment had just resumed returned a conflict error, although the request had nothing to do.
- An automation agent wrote a test that read `git diff origin/main`. It passed on its branch and would fail once merged.
- Spec and QA working files were committed into product branches.

## Decision

- **One Task at a time per repo.** Dispatch does not start a ready Task while another top-level run on a Task that names one of the same repos is `running` or `waiting_for_owner`. A parked run keeps its repo until the Owner resolves it. Parallelism is still allowed across different repos, up to `max_parallel_runs`.
- **Resume is idempotent.** Resuming a run that is already `running` succeeds. A finished run still refuses.
- **No git-history tests.** The automation agent may not write tests that read git history, a diff, or another branch. It tests files on disk.
- **Atlas artifacts stay out of commits.** `specs/` and `tests/qa/` are excluded from workflow commits, as recorded in `services/atlas-artifacts.ts`.

## Consequences

- A stalled Task blocks the other Tasks in its repo until someone resolves it. This is deliberate: it trades throughput for pull requests that merge.
- Rebase conflicts with `main` still park the run with a clear message. They are rarer now, but not automated.
- The sub-task status rules stay strict, as decided by the Owner.
