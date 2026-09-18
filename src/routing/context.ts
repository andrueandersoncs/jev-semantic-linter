import { basename, dirname, posix } from "node:path";
import {
  sourceCandidates,
  type SemanticLintEvidence,
  type SemanticLintRepositoryEvidence,
  type SemanticLintSource,
} from "../semantic-lint-evidence";
import {
  importSpecifiers,
  resolvedRelativeImport,
} from "../semantic-lint-imports";
import type { SemanticLintConfiguration } from "../semantic-lint-config";
import type { SemanticLintRule } from "../semantic-lint-rules";
import { domainForPath, type RoutedHunk, truncateBytes } from "./choice";

type Relation = Readonly<{
  owner: string;
  path: string;
  relation: string;
}>;

export type RepositoryRelations = ReadonlyMap<
  string,
  readonly Readonly<{ path: string; relation: string }>[]
>;

function ancestorDirectories(path: string): readonly string[] {
  const parent = dirname(path);
  if (parent === ".") {
    return ["."];
  }
  return [parent, ...ancestorDirectories(parent)];
}

function importRelations(
  evidence: SemanticLintRepositoryEvidence,
): readonly Relation[] {
  const sourcePaths = new Set(evidence.files.map((file) => file.path));
  return evidence.files.flatMap((file) =>
    importSpecifiers(file).flatMap((specifier) => {
      const target = resolvedRelativeImport(file.path, specifier, sourcePaths);
      if (target === undefined) {
        return [];
      }
      return [
        { owner: file.path, path: target, relation: "imported dependency" },
        { owner: target, path: file.path, relation: "importer" },
      ];
    }),
  );
}

function configurationRelations(
  evidence: SemanticLintRepositoryEvidence,
): readonly Relation[] {
  const sourcePaths = new Set(evidence.files.map((file) => file.path));
  const names = ["package.json", "tsconfig.json", "bunfig.toml"];
  return evidence.files.flatMap((file) =>
    ancestorDirectories(file.path).flatMap((directory) =>
      names.flatMap((name) => {
        const path = directory === "." ? name : posix.join(directory, name);
        return sourcePaths.has(path)
          ? [{ owner: file.path, path, relation: "owning configuration" }]
          : [];
      }),
    ),
  );
}

function testRelations(
  evidence: SemanticLintRepositoryEvidence,
): readonly Relation[] {
  const tests = evidence.files.filter(
    (file) => domainForPath(file.path) === "tests",
  );
  return evidence.files.flatMap((file) => {
    const stem = basename(file.path)
      .replace(/\.[^.]+$/, "")
      .replace(/\.(test|spec)$/, "");
    return tests.flatMap((test) =>
      basename(test.path).includes(stem)
        ? [{ owner: file.path, path: test.path, relation: "matching test" }]
        : [],
    );
  });
}

export function repositoryRelations(
  evidence: SemanticLintRepositoryEvidence,
): RepositoryRelations {
  const relations = [
    ...importRelations(evidence),
    ...configurationRelations(evidence),
    ...testRelations(evidence),
  ];
  const grouped = Map.groupBy(relations, (relation) => relation.owner);
  return new Map(
    [...grouped.entries()].map(([owner, values]) => [
      owner,
      values
        .filter(
          (value, index) =>
            values.findIndex(
              (candidate) =>
                candidate.path === value.path &&
                candidate.relation === value.relation,
            ) === index,
        )
        .map(({ path, relation }) => ({ path, relation })),
    ]),
  );
}

function sourceEvidence(
  source: SemanticLintSource,
  id: string,
  kind: string,
  relation: string,
  maximumBytes: number,
  startLine = 1,
  endLine = source.source.split("\n").length,
): SemanticLintEvidence {
  return {
    id,
    kind,
    relation,
    path: source.path,
    startLine,
    endLine,
    snippet: truncateBytes(source.source, maximumBytes),
  };
}

function hunkEvidence(
  selected: RoutedHunk,
  config: SemanticLintConfiguration,
): SemanticLintEvidence {
  const { file, hunk } = selected;
  const usesOldLines = hunk.newLineCount === 0;
  const startLine = usesOldLines ? hunk.oldStartLine : hunk.newStartLine;
  const lineCount = usesOldLines ? hunk.oldLineCount : hunk.newLineCount;
  return {
    id: hunk.id,
    kind: "diff-hunk",
    relation: "routed change",
    path: file.path,
    startLine,
    endLine: startLine + Math.max(lineCount - 1, 0),
    snippet: truncateBytes(
      hunk.patch,
      config.routing.maximumEvidenceSnippetBytes,
    ),
  };
}

function enclosingSourceEvidence(
  selected: RoutedHunk,
  source: SemanticLintSource | undefined,
  config: SemanticLintConfiguration,
): readonly SemanticLintEvidence[] {
  if (source === undefined) {
    return [];
  }
  const targetLine = Math.max(selected.hunk.newStartLine, 1);
  const containing = sourceCandidates(source, config.evidence).find(
    (candidate) =>
      candidate.startLine <= targetLine && candidate.endLine >= targetLine,
  );
  if (containing === undefined) {
    return [];
  }
  return [
    {
      id: `${selected.hunk.id}_source`,
      kind: "source-context",
      relation: "enclosing changed source",
      path: source.path,
      startLine: containing.startLine,
      endLine: containing.endLine,
      snippet: truncateBytes(
        containing.source,
        config.routing.maximumEvidenceSnippetBytes,
      ),
    },
  ];
}

function relatedEvidence(
  selected: RoutedHunk,
  sourceByPath: ReadonlyMap<string, SemanticLintSource>,
  relations: RepositoryRelations,
  config: SemanticLintConfiguration,
): readonly SemanticLintEvidence[] {
  return (relations.get(selected.file.path) ?? []).flatMap(
    (relation, index) => {
      const source = sourceByPath.get(relation.path);
      return source === undefined
        ? []
        : [
            sourceEvidence(
              source,
              `${selected.hunk.id}_related_${index + 1}`,
              "repository-context",
              relation.relation,
              config.routing.maximumEvidenceSnippetBytes,
            ),
          ];
    },
  );
}

function peerEvidence(
  rule: SemanticLintRule,
  selected: RoutedHunk,
  evidence: SemanticLintRepositoryEvidence,
  config: SemanticLintConfiguration,
): readonly SemanticLintEvidence[] {
  if (rule.metadata.scope !== "repository") {
    return [];
  }
  const file = selected.file;
  return evidence.files
    .filter(
      (candidate) =>
        dirname(candidate.path) === dirname(file.path) &&
        candidate.path !== file.path,
    )
    .slice(0, config.routing.maximumExpandedCandidates)
    .map((peer, index) =>
      sourceEvidence(
        peer,
        `${selected.hunk.id}_peer_${index + 1}`,
        "repository-context",
        "same-directory convention",
        config.routing.maximumEvidenceSnippetBytes,
      ),
    );
}

export function expandEvidence(
  rule: SemanticLintRule,
  routed: readonly RoutedHunk[],
  evidence: SemanticLintRepositoryEvidence,
  config: SemanticLintConfiguration,
  relations: RepositoryRelations,
): readonly SemanticLintEvidence[] {
  const sourceByPath = new Map(
    evidence.files.map((file) => [file.path, file] as const),
  );
  const reviewContext =
    rule.metadata.evaluator === "review" && evidence.reviewContext !== undefined
      ? [
          sourceEvidence(
            evidence.reviewContext,
            "review_context",
            "review-context",
            "supplied requirement or rationale",
            config.routing.maximumEvidenceSnippetBytes,
          ),
        ]
      : [];
  const routedEvidence = routed.flatMap((selected) => [
    hunkEvidence(selected, config),
    ...enclosingSourceEvidence(
      selected,
      sourceByPath.get(selected.file.path),
      config,
    ),
    ...relatedEvidence(selected, sourceByPath, relations, config),
    ...peerEvidence(rule, selected, evidence, config),
  ]);
  const candidates = [...reviewContext, ...routedEvidence];
  return candidates
    .filter((candidate, index) => {
      const key = `${candidate.kind}:${candidate.path}:${candidate.startLine ?? 0}:${candidate.endLine ?? 0}`;
      return (
        candidates.findIndex((item) => {
          const itemKey = `${item.kind}:${item.path}:${item.startLine ?? 0}:${item.endLine ?? 0}`;
          return itemKey === key;
        }) === index
      );
    })
    .slice(0, config.routing.maximumExpandedCandidates);
}
