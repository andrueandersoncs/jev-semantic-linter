import { $ } from "bun";
import { errorMessage } from "../../error-message";
import type { GitAccessError } from "../errors";
import { fail, ok, type Result } from "../../result";

type GitEvidenceKind =
  | "tracked changes"
  | "untracked files"
  | "repository files"
  | "deleted repository files"
  | "working-tree diff";

type GitCommand = () => $.ShellPromise;
function pathsFromNullSeparatedText(text: string): readonly string[] {
  return text.split("\0").filter((path) => path.length > 0);
}

function changedPathsFromGitText(
  trackedChanges: string,
  untrackedFiles: string,
): readonly string[] {
  const paths = [
    ...pathsFromNullSeparatedText(trackedChanges),
    ...pathsFromNullSeparatedText(untrackedFiles),
  ];
  const sortedPaths = paths.toSorted();
  return sortedPaths.filter((path, index) => path !== sortedPaths[index - 1]);
}

async function gitOutputText(
  operation: GitEvidenceKind,
  command: GitCommand,
): Promise<Result<string, GitAccessError>> {
  try {
    const result = await command().quiet().nothrow();
    if (result.exitCode === 0) {
      return ok(result.text());
    }
    const detail = result.stderr.toString().trim();
    return fail({
      tag: "GitAccessError",
      operation,
      message: `Could not read ${operation}: ${detail}`,
      cause: result,
    });
  } catch (cause) {
    return fail({
      tag: "GitAccessError",
      operation,
      message: `Could not read ${operation}: ${errorMessage(cause)}`,
      cause,
    });
  }
}

export type SemanticLintGitSnapshot = Readonly<{
  changedPaths: readonly string[];
  repositoryPaths: readonly string[];
  diff: string;
}>;

export type SemanticLintGitAccess = Readonly<{
  repositorySnapshot: () => Promise<
    Result<SemanticLintGitSnapshot, GitAccessError>
  >;
}>;

async function changedFilePaths() {
  const [tracked, untracked] = await Promise.all([
    gitOutputText("tracked changes", () => $`git diff --name-only -z HEAD --`),
    gitOutputText(
      "untracked files",
      () => $`git ls-files --others --exclude-standard -z`,
    ),
  ]);
  if (!tracked.ok) {
    return tracked;
  }
  if (!untracked.ok) {
    return untracked;
  }
  return ok(changedPathsFromGitText(tracked.value, untracked.value));
}

async function repositoryFilePaths() {
  const [repository, deleted] = await Promise.all([
    gitOutputText(
      "repository files",
      () => $`git ls-files --cached --others --exclude-standard -z`,
    ),
    gitOutputText(
      "deleted repository files",
      () => $`git ls-files --deleted -z`,
    ),
  ]);
  if (!repository.ok) {
    return repository;
  }
  if (!deleted.ok) {
    return deleted;
  }
  const deletedPaths = new Set(changedPathsFromGitText(deleted.value, ""));
  return ok(
    changedPathsFromGitText(repository.value, "").filter(
      (path) => !deletedPaths.has(path),
    ),
  );
}

async function workingTreeDiff() {
  return gitOutputText(
    "working-tree diff",
    () => $`git diff --no-ext-diff --unified=3 HEAD --`,
  );
}

/** Git process boundary. */
export const gitChanges: SemanticLintGitAccess = {
  async repositorySnapshot() {
    const [changedPaths, repositoryPaths, diff] = await Promise.all([
      changedFilePaths(),
      repositoryFilePaths(),
      workingTreeDiff(),
    ]);
    if (!changedPaths.ok) {
      return changedPaths;
    }
    if (!repositoryPaths.ok) {
      return repositoryPaths;
    }
    if (!diff.ok) {
      return diff;
    }
    return ok({
      changedPaths: changedPaths.value,
      repositoryPaths: repositoryPaths.value,
      diff: diff.value,
    });
  },
};
