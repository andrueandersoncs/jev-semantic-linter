import { extname } from "node:path";
import { Effect } from "effect";
import type { SemanticLintFileAccess } from "./runtime/files";
import type { FileAccessError } from "./errors";
import type { SemanticLintConfiguration } from "./config";
export type SemanticLintSource = Readonly<{
  path: string;
  language: string;
  source: string;
}>;

export type SemanticLintSourceCandidate = Readonly<{
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  source: string;
}>;

export type SemanticLintDiffHunk = Readonly<{
  id: string;
  path: string;
  oldStartLine: number;
  oldLineCount: number;
  newStartLine: number;
  newLineCount: number;
  header: string;
  patch: string;
}>;

export type SemanticLintDiffFile = Readonly<{
  id: string;
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  hunks: readonly SemanticLintDiffHunk[];
}>;

export type SemanticLintRepositoryEvidence = Readonly<{
  paths: readonly string[];
  changedPaths: readonly string[];
  deletedPaths: readonly string[];
  files: readonly SemanticLintSource[];
  reviewContext?: SemanticLintSource;
  diffFiles: readonly SemanticLintDiffFile[];
}>;

export type SemanticLintEvidence = Readonly<{
  id?: string;
  kind?: string;
  relation?: string;
  path: string;
  startLine?: number;
  endLine?: number;
  snippet?: string;
  relevanceProbability?: number;
}>;

function sourceFromText(path: string, source: string): SemanticLintSource {
  const extension = extname(path);
  return {
    path,
    language: extension.length > 1 ? extension.slice(1) : "unknown",
    source,
  };
}

export function sourceCandidates(
  source: SemanticLintSource,
  config: SemanticLintConfiguration["evidence"],
): readonly SemanticLintSourceCandidate[] {
  const lines = source.source.split("\n");
  const chunkLineCount = config.sourceChunkLineCount;
  const step = chunkLineCount - config.sourceChunkOverlapLineCount;
  const chunkCount =
    Math.ceil(Math.max(0, lines.length - chunkLineCount) / step) + 1;
  return Array.from({ length: chunkCount }, (_unused, index) => {
    const startIndex = index * step;
    const chunk = lines.slice(startIndex, startIndex + chunkLineCount);
    return {
      path: source.path,
      language: source.language,
      startLine: startIndex + 1,
      endLine: startIndex + chunk.length,
      source: chunk.join("\n"),
    };
  });
}

function diffPath(line: string, prefix: "--- " | "+++ "): string | undefined {
  const value = line.slice(prefix.length).split("\t", 1)[0] ?? "";
  if (value === "/dev/null") {
    return undefined;
  }
  const unquoted =
    value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\")
      : value;
  return unquoted.replace(/^[ab]\//, "");
}

function hunkFromLines(
  fileId: string,
  filePath: string,
  hunkIndex: number,
  lines: readonly string[],
): SemanticLintDiffHunk | undefined {
  const firstLine = lines[0];
  const match = firstLine?.match(
    /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/,
  );
  if (match === null || match === undefined) {
    return undefined;
  }
  const newStartLine = Number(match[3]);
  const newLineCount = Number(match[4] ?? 1);
  return {
    id: `${fileId}_hunk_${hunkIndex + 1}`,
    path: filePath,
    oldStartLine: Number(match[1]),
    oldLineCount: Number(match[2] ?? 1),
    newStartLine,
    newLineCount,
    header: match[5]?.trim() || firstLine || "",
    patch: lines.join("\n"),
  };
}

function hunksFromSection(
  fileId: string,
  filePath: string,
  lines: readonly string[],
): readonly SemanticLintDiffHunk[] {
  const starts = lines.flatMap((line, index) =>
    line.startsWith("@@ ") ? [index] : [],
  );
  return starts.flatMap((start, index) => {
    const end = starts[index + 1] ?? lines.length;
    const hunk = hunkFromLines(
      fileId,
      filePath,
      index,
      lines.slice(start, end),
    );
    return hunk === undefined ? [] : [hunk];
  });
}

function fileFromDiffSection(
  section: string,
  index: number,
): SemanticLintDiffFile | undefined {
  const lines = section.split("\n");
  const oldHeader = lines.find((line) => line.startsWith("--- "));
  const newHeader = lines.find((line) => line.startsWith("+++ "));
  const oldPath =
    oldHeader === undefined ? undefined : diffPath(oldHeader, "--- ");
  const path =
    newHeader === undefined ? undefined : diffPath(newHeader, "+++ ");
  const filePath = path ?? oldPath;
  if (filePath === undefined) {
    return undefined;
  }
  const id = `file_${index + 1}`;
  const status =
    oldPath === undefined
      ? "added"
      : path === undefined
        ? "deleted"
        : oldPath !== path
          ? "renamed"
          : "modified";
  return {
    id,
    path: filePath,
    ...(oldPath !== undefined && oldPath !== filePath
      ? { previousPath: oldPath }
      : {}),
    status,
    hunks: hunksFromSection(id, filePath, lines),
  };
}

function parsedDiffFiles(diff: string): readonly SemanticLintDiffFile[] {
  return diff.split(/(?=^diff --git )/m).flatMap((section, index) => {
    const file = fileFromDiffSection(section, index);
    return file === undefined ? [] : [file];
  });
}

export function diffFilesFromEvidence(
  diff: string,
  changedPaths: readonly string[],
  deletedPaths: readonly string[],
  files: readonly SemanticLintSource[],
  config: SemanticLintConfiguration["evidence"],
): readonly SemanticLintDiffFile[] {
  const parsed = parsedDiffFiles(diff);
  const parsedPaths = new Set(parsed.map((file) => file.path));
  const sourceByPath = new Map(files.map((file) => [file.path, file]));
  const additions = changedPaths.flatMap((path, changedIndex) => {
    if (parsedPaths.has(path)) {
      return [];
    }
    const source = sourceByPath.get(path);
    const fileId = `file_${parsed.length + changedIndex + 1}`;
    if (source === undefined) {
      return [{ id: fileId, path, status: "deleted" as const, hunks: [] }];
    }
    const hunks = sourceCandidates(source, config).map((candidate, index) => ({
      id: `${fileId}_hunk_${index + 1}`,
      path,
      oldStartLine: 0,
      oldLineCount: 0,
      newStartLine: candidate.startLine,
      newLineCount: candidate.endLine - candidate.startLine + 1,
      header: "Untracked file",
      patch: candidate.source,
    }));
    return [
      {
        id: fileId,
        path,
        status: deletedPaths.includes(path)
          ? ("deleted" as const)
          : ("untracked" as const),
        hunks,
      },
    ];
  });
  return [...parsed, ...additions];
}

type RepositoryEvidenceInput = Readonly<{
  repositoryPaths: readonly string[];
  changedPaths: readonly string[];
  diff: string;
  config: SemanticLintConfiguration["evidence"];
}>;

export function repositoryEvidence(
  input: RepositoryEvidenceInput,
  files: SemanticLintFileAccess,
): Effect.Effect<SemanticLintRepositoryEvidence, FileAccessError> {
  return Effect.gen(function* () {
    const repositoryPathSet = new Set(input.repositoryPaths);
    const repositoryExtensions = new Set(input.config.repositoryFileExtensions);
    const evidencePaths = input.repositoryPaths.filter((path) =>
      repositoryExtensions.has(extname(path)),
    );
    const repositoryFiles = yield* Effect.forEach(
      evidencePaths,
      (path) =>
        Effect.map(files.readText(path), (source) =>
          sourceFromText(path, source),
        ),
      { concurrency: "unbounded" },
    );
    const deletedPaths = input.changedPaths.filter(
      (path) => !repositoryPathSet.has(path),
    );
    return {
      paths: input.repositoryPaths,
      changedPaths: input.changedPaths,
      deletedPaths,
      files: repositoryFiles,
      diffFiles: diffFilesFromEvidence(
        input.diff,
        input.changedPaths,
        deletedPaths,
        repositoryFiles,
        input.config,
      ),
    };
  });
}
