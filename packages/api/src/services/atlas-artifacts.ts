// Paths the agents write for Atlas's own use. They are working notes, not
// product code, so they must never reach a commit or a pull request. Found
// when Apple Shop's PRs carried generated spec and QA files into the repo.
const ATLAS_ARTIFACT_PATHS = ['specs', 'tests/qa'] as const;

/**
 * The `git add` arguments that stage a worktree's real changes and leave the
 * Atlas artifacts out. Excluded pathspecs apply to tracked and untracked files
 * alike, so an artifact cannot slip in by being already tracked either.
 */
export function stageArgs(): string[] {
    return ['add', '-A', '--', '.', ...ATLAS_ARTIFACT_PATHS.map((p) => `:(exclude)${p}`)];
}
