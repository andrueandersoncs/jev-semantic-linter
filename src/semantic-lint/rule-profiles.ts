import type { SemanticLintRule } from "./rules";

const deterministicChecks: Readonly<Record<string, string>> = {
  "rules/filenames/use-distinct-filenames.md": "distinct-filenames",
  "rules/bun-builds/choose-the-install-linker-deliberately.md":
    "bun-install-linker",
  "rules/bun-builds/declare-dependencies-in-every-consuming-workspace.md":
    "declared-workspace-dependencies",
  "rules/bun-builds/use-one-pinned-bun-toolchain-and-root-lockfile.md":
    "pinned-bun-toolchain",
  "rules/testing-enforcement/enforce-important-rules-automatically.md":
    "root-check-command",
  "rules/testing-enforcement/choose-test-runners-and-type-check-explicitly.md":
    "test-and-typecheck-commands",
  "rules/repository-boundaries/import-packages-through-public-exports.md":
    "workspace-public-imports",
  "rules/repository-boundaries/enforce-acyclic-dependency-direction.md":
    "acyclic-dependencies",
  "rules/modularity/keep-dependencies-acyclic.md": "acyclic-dependencies",
  "rules/typescript-contracts/use-strict-runtime-specific-tsconfig-files.md":
    "strict-runtime-tsconfig",
};

const reviewEvidence: Readonly<Record<string, readonly string[]>> = {
  "rules/simplicity/require-each-change-to-justify-its-complexity.md": [
    "the requirement and acceptance criteria",
    "considered alternatives",
  ],
  "rules/simplicity/solve-the-problem-that-exists.md": [
    "the reported problem and required behavior",
  ],
  "rules/simplicity/optimize-demonstrated-bottlenecks-not-imagined-ones.md": [
    "before-and-after performance measurements",
  ],
  "rules/simplicity/make-dependencies-earn-their-complexity.md": [
    "the dependency rationale and considered built-in alternatives",
  ],
  "rules/abstraction/require-a-net-reduction-in-complexity.md": [
    "the before-and-after complexity rationale",
  ],
  "rules/abstraction/name-the-concrete-problem-an-abstraction-solves.md": [
    "the abstraction's stated purpose",
  ],
  "rules/abstraction/define-the-contract-before-the-implementation.md": [
    "the contract and implementation chronology",
  ],
  "rules/abstraction/generalize-from-demonstrated-needs.md": [
    "demonstrated use cases and their history",
  ],
  "rules/abstraction/keep-adoption-focused-and-reversible.md": [
    "the rollout and rollback plan",
  ],
};

const repositoryPrefixes = [
  "rules/abstraction/",
  "rules/bun-builds/",
  "rules/file-code-organization/",
  "rules/filenames/",
  "rules/modularity/",
  "rules/repository-boundaries/",
  "rules/repository-maintenance/",
  "rules/testing-enforcement/",
  "rules/typescript-contracts/",
  "rules/web-boundaries/",
];

const repositoryRules: Readonly<Record<string, true>> = {
  "rules/avoid-repetition.md": true,
  "rules/simplicity/follow-existing-conventions-unless-there-is-a-clear-reason-not-to.md": true,
  "rules/simplicity/remove-what-no-longer-contributes.md": true,
};

const changeRules: Readonly<Record<string, true>> = {
  "rules/simplicity/preserve-necessary-safeguards.md": true,
  "rules/simplicity/let-abstractions-emerge-from-concrete-needs.md": true,
};

export function metadataForRule(
  rulePath: string,
): SemanticLintRule["metadata"] {
  const deterministicCheck = deterministicChecks[rulePath];
  if (deterministicCheck) {
    return {
      evaluator: "deterministic",
      scope: "repository",
      deterministicCheck,
      requiredEvidence: ["repository paths and configuration"],
    };
  }

  const requiredEvidence = reviewEvidence[rulePath];
  if (requiredEvidence) {
    return {
      evaluator: "review",
      scope: "change",
      requiredEvidence,
    };
  }

  if (changeRules[rulePath]) {
    return {
      evaluator: "semantic",
      scope: "change",
      requiredEvidence: ["working-tree diff and changed sources"],
    };
  }

  if (
    repositoryRules[rulePath] ||
    repositoryPrefixes.some((prefix) => rulePath.startsWith(prefix))
  ) {
    return {
      evaluator: "semantic",
      scope: "repository",
      requiredEvidence: ["repository paths, source, configuration, and diff"],
    };
  }

  return {
    evaluator: "semantic",
    scope: "source",
    requiredEvidence: ["changed source and repository context"],
  };
}
