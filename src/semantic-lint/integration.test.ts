import { describe, expect, test } from "bun:test";
import type {
  ChoiceResponse,
  NoulResponse,
  ScoreResponse,
} from "@typesafe-ai/sdk";
import { Effect } from "effect";
import { semanticLintConfig, type SemanticLintConfiguration } from "./config";
import { truncateBytes } from "./routing/choice";
import type { SemanticLintFileAccess } from "./runtime/files";
import { deterministicFindings } from "./deterministic";
import { evaluateSemanticLint } from "./routing/evaluation";
import type {
  SemanticLintEvaluation,
  SemanticLintEvaluationRequest,
} from "./evaluator";
import {
  diffFilesFromEvidence,
  type SemanticLintRepositoryEvidence,
} from "./evidence";
import { TypeSafeEvaluationError } from "./errors";
import type { SemanticLintOutcome } from "./report";
import { rulesFromFiles, type SemanticLintRule } from "./rules";

const config = semanticLintConfig;

function ruleSource(
  definition: string,
  globs: readonly string[] = ["**/*"],
): string {
  const entries = globs.map((glob) => `  - ${JSON.stringify(glob)}`).join("\n");
  return `---\nglobs:\n${entries}\n---\n${definition}`;
}

function deterministicRule(
  rulePath: string,
  deterministicCheck: string,
): SemanticLintRule {
  return {
    ruleId: "rule_1",
    rulePath,
    ruleTitle: rulePath,
    definition: `# ${rulePath}`,
    globs: ["**/*"],
    metadata: {
      evaluator: "deterministic",
      scope: "repository",
      deterministicCheck,
      requiredEvidence: ["repository"],
    },
  };
}

function repositoryEvidence(
  paths: readonly string[],
  sources: Readonly<Record<string, string>>,
  changedPaths: readonly string[] = paths,
): SemanticLintRepositoryEvidence {
  const files = Object.entries(sources).map(([path, source]) => ({
    path,
    language: path.split(".").at(-1) ?? "unknown",
    source,
  }));
  const deletedPaths: readonly string[] = [];
  return {
    paths,
    changedPaths,
    deletedPaths,
    files,
    diffFiles: diffFilesFromEvidence(
      "",
      changedPaths,
      deletedPaths,
      files,
      config.evidence,
    ),
  };
}
function successfulEvaluator(
  choose?: (options: readonly string[]) => string,
  noulProbability?: (questionJson: string) => number,
): SemanticLintEvaluation {
  return {
    evaluate: (request) => {
      const answers = Object.fromEntries(
        Object.entries(request.questions).map(([id, question]) => {
          if (question.type === "choice") {
            const options = Object.keys(question.criteria);
            const selected =
              choose?.(options) ??
              options.find((option) => option !== "none") ??
              "none";
            const otherProbability =
              options.length > 1 ? 0.1 / (options.length - 1) : 0;
            const answer: ChoiceResponse = {
              type: "choice",
              choice: selected,
              confidence: 0.9,
              probabilities: Object.fromEntries(
                options.map((option) => [
                  option,
                  option === selected ? 0.9 : otherProbability,
                ]),
              ),
            };
            return [id, answer];
          }
          if (question.type === "score") {
            const answer: ScoreResponse = {
              type: "score",
              score: 0,
              confidence: 1,
              legend: { 0: null, 1: null },
              probabilities: { 0: 1, 1: 0 },
            };
            return [id, answer];
          }
          const answer: NoulResponse = {
            type: "noul",
            noul: noulProbability?.(JSON.stringify(question)) ?? 0.95,
          };
          return [id, answer];
        }),
      );
      return Effect.succeed({
        model: "test-model",
        answers,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  };
}

function failedEvaluation(message: string) {
  return Effect.fail(new TypeSafeEvaluationError({ message }));
}

function jsonDocuments(outcome: SemanticLintOutcome) {
  return outcome.report.format === "json" ? outcome.report.documents : [];
}

test("fails when configured rules match no files", async () => {
  const files: SemanticLintFileAccess = {
    findPaths: () => Effect.succeed([]),
    readText: () => Effect.succeed(""),
  };
  const error = await Effect.runPromise(
    Effect.flip(
      evaluateSemanticLint(
        {
          evidence: repositoryEvidence(["src/item.ts"], {
            "src/item.ts": "export const item = 1;",
          }),
          options: {
            violationProbabilityThreshold: 0.7,
            outputFormat: "json",
            mode: "dry-run",
          },
          config,
        },
        files,
        Effect.succeed(successfulEvaluator()),
      ),
    ),
  );
  expect(error).toMatchObject({ _tag: "RuleFileError" });
});

test("discovers custom Markdown rules without registration", async () => {
  const rulePath = "rules/team/no-debugger.md";
  const files: SemanticLintFileAccess = {
    findPaths: (pattern) => {
      expect(pattern).toBe("rules/**/*.md");
      return Effect.succeed([rulePath]);
    },
    readText: () =>
      Effect.succeed(
        ruleSource(
          "# Do not commit debugger statements\n\nRemove debugger statements.",
          ["src/**/*.ts"],
        ),
      ),
  };
  const rules = await Effect.runPromise(rulesFromFiles(files));
  expect(rules[0]).toMatchObject({
    rulePath,
    ruleTitle: "Do not commit debugger statements",
    definition:
      "# Do not commit debugger statements\n\nRemove debugger statements.",
    globs: ["src/**/*.ts"],
  });
});

test("rejects rule files without glob frontmatter", async () => {
  const rulePath = "rules/example.md";
  const files: SemanticLintFileAccess = {
    findPaths: () => Effect.succeed([rulePath]),
    readText: () => Effect.succeed("# Example rule\n\nCheck TypeScript."),
  };
  const error = await Effect.runPromise(Effect.flip(rulesFromFiles(files)));
  expect(error).toMatchObject({
    _tag: "RuleFileError",
    path: rulePath,
  });
});

describe("deterministic repository checks", () => {
  test("reports duplicate filenames with both paths", () => {
    const evidence = repositoryEvidence(
      ["apps/a/index.ts", "packages/b/index.ts"],
      {
        "apps/a/index.ts": "export const a = 1;",
        "packages/b/index.ts": "export const b = 2;",
      },
    );
    const [finding] = deterministicFindings(
      [
        deterministicRule(
          "rules/filenames/use-distinct-filenames.md",
          "distinct-filenames",
        ),
      ],
      evidence,
    );
    expect(finding?.classification).toBe("violation");
    expect(finding?.evidence.map((item) => item.path)).toEqual([
      "apps/a/index.ts",
      "packages/b/index.ts",
    ]);
  });

  test("reports undeclared imports in the owning package", () => {
    const evidence = repositoryEvidence(["package.json", "src/index.ts"], {
      "package.json": JSON.stringify({ dependencies: {} }),
      "src/index.ts": 'import value from "missing-package";',
    });
    const [finding] = deterministicFindings(
      [
        deterministicRule(
          "rules/bun-builds/declare-dependencies-in-every-consuming-workspace.md",
          "declared-workspace-dependencies",
        ),
      ],
      evidence,
    );
    expect(finding?.classification).toBe("violation");
    expect(finding?.message).toContain("missing-package");
  });

  test("ignores Bun built-ins and import text inside strings", () => {
    const evidence = repositoryEvidence(["package.json", "src/index.ts"], {
      "package.json": JSON.stringify({ dependencies: {} }),
      "src/index.ts": [
        'import { $ } from "bun";',
        "const fixture = 'import value from \"missing-package\";';",
      ].join("\n"),
    });
    const [finding] = deterministicFindings(
      [
        deterministicRule(
          "rules/bun-builds/declare-dependencies-in-every-consuming-workspace.md",
          "declared-workspace-dependencies",
        ),
      ],
      evidence,
    );
    expect(finding?.classification).toBe("pass");
  });

  test("reports relative import cycles", () => {
    const evidence = repositoryEvidence(["src/a.ts", "src/b.ts"], {
      "src/a.ts": 'import "./b";',
      "src/b.ts": 'import "./a";',
    });
    const [finding] = deterministicFindings(
      [
        deterministicRule(
          "rules/modularity/keep-dependencies-acyclic.md",
          "acyclic-dependencies",
        ),
      ],
      evidence,
    );
    expect(finding?.classification).toBe("violation");
    expect(finding?.evidence).toHaveLength(2);
  });
});
test("keeps untracked documentation as repository evidence", () => {
  const files = [
    {
      path: "ARCHITECTURE.md",
      language: "md",
      source: "# Architecture",
    },
  ];
  const parsed = diffFilesFromEvidence(
    "",
    ["ARCHITECTURE.md"],
    [],
    files,
    config.evidence,
  );
  expect(parsed).toMatchObject([
    {
      path: "ARCHITECTURE.md",
      status: "untracked",
      hunks: [{ patch: "# Architecture" }],
    },
  ]);
});

test("maps unified diff files and line ranges", () => {
  const diff = [
    "diff --git a/src/first.ts b/src/first.ts",
    "--- a/src/first.ts",
    "+++ b/src/first.ts",
    "@@ -1 +1 @@",
    "-export const first = 0;",
    "+export const first = 1;",
    "diff --git a/src/second.ts b/src/second.ts",
    "--- a/src/second.ts",
    "+++ b/src/second.ts",
    "@@ -2,0 +2,2 @@",
    "+export const second = 2;",
    "+export const third = 3;",
  ].join("\n");
  const files = [
    { path: "src/first.ts", language: "ts", source: "export const first = 1;" },
    {
      path: "src/second.ts",
      language: "ts",
      source: "export const second = 2;\nexport const third = 3;",
    },
  ];
  const parsed = diffFilesFromEvidence(
    diff,
    files.map((file) => file.path),
    [],
    files,
    config.evidence,
  );
  expect(
    parsed.map((file) => ({ path: file.path, status: file.status })),
  ).toEqual([
    { path: "src/first.ts", status: "modified" },
    { path: "src/second.ts", status: "modified" },
  ]);
  expect(
    parsed.map((file) =>
      file.hunks.map((hunk) => ({
        oldStartLine: hunk.oldStartLine,
        newStartLine: hunk.newStartLine,
        newLineCount: hunk.newLineCount,
      })),
    ),
  ).toEqual([
    [{ oldStartLine: 1, newStartLine: 1, newLineCount: 1 }],
    [{ oldStartLine: 2, newStartLine: 2, newLineCount: 2 }],
  ]);
  expect(parsed[0]?.hunks[0]?.patch).toContain("+export const first = 1;");
  expect(parsed[1]?.hunks[0]?.patch).toContain("+export const third = 3;");
});

test("Choice routing excludes unselected diff content from final judgment", async () => {
  const rulePath = "rules/function-naming.md";
  const definitions: Readonly<Record<string, string>> = {
    [rulePath]: ruleSource(
      "# Name functions by purpose\n\nUse clear function names.",
      ["src/second.ts"],
    ),
  };
  const files: SemanticLintFileAccess = {
    findPaths: () => Effect.succeed([rulePath]),
    readText: (path) => Effect.succeed(definitions[path] ?? ""),
  };
  const diff = [
    "diff --git a/src/first.ts b/src/first.ts",
    "--- a/src/first.ts",
    "+++ b/src/first.ts",
    "@@ -1 +1 @@",
    "-export const first = 0;",
    "+export const FIRST_ONLY_MARKER = 1;",
    "diff --git a/src/second.ts b/src/second.ts",
    "--- a/src/second.ts",
    "+++ b/src/second.ts",
    "@@ -1 +1 @@",
    "-export const second = 0;",
    "+export const SECOND_ONLY_MARKER = 2;",
  ].join("\n");
  const baseEvidence = repositoryEvidence(["src/first.ts", "src/second.ts"], {
    "src/first.ts": "export const FIRST_ONLY_MARKER = 1;",
    "src/second.ts": "export const SECOND_ONLY_MARKER = 2;",
  });
  const evidence: SemanticLintRepositoryEvidence = {
    ...baseEvidence,
    diffFiles: diffFilesFromEvidence(
      diff,
      baseEvidence.changedPaths,
      baseEvidence.deletedPaths,
      baseEvidence.files,
      config.evidence,
    ),
  };
  const delegate = successfulEvaluator(
    (options) =>
      options.includes("file_2")
        ? "file_2"
        : (options.find((option) => option !== "none") ?? "none"),
    (questionJson) => (questionJson.includes("file_1") ? 0.1 : 0.95),
  );
  const evaluator: SemanticLintEvaluation = {
    evaluate: (request, options) => {
      const requestJson = JSON.stringify(request);
      if (requestJson.includes("diff --git")) {
        return failedEvaluation("Raw diff crossed the evaluator boundary");
      }
      if (
        "rule_1" in request.questions &&
        requestJson.includes("FIRST_ONLY_MARKER")
      ) {
        return failedEvaluation(
          "Unselected evidence crossed the evaluator boundary",
        );
      }
      return delegate.evaluate(request, options);
    },
  };
  const outcomes = await Effect.runPromise(
    evaluateSemanticLint(
      {
        evidence,
        options: {
          violationProbabilityThreshold: 0.7,
          outputFormat: "json",
          mode: "live",
        },
        config,
      },
      files,
      Effect.succeed(evaluator),
    ),
  );
  const finding = jsonDocuments(outcomes).flatMap((document) =>
    "findings" in document ? document.findings : [],
  )[0];
  expect(
    finding?.evidence.every((item) => item.path === "src/second.ts"),
  ).toBeTrue();
  expect(finding?.routing?.decisions).toContainEqual({
    stage: "path",
    candidate: "file_2",
    probability: 1,
    selected: true,
  });
});

test("batches rule judgments that share routed evidence", async () => {
  const definitions: Readonly<Record<string, string>> = {
    "rules/first.md": ruleSource("# First rule\n\nCheck the first rule."),
    "rules/second.md": ruleSource("# Second rule\n\nCheck the second rule."),
  };
  const files: SemanticLintFileAccess = {
    findPaths: () => Effect.succeed(Object.keys(definitions)),
    readText: (path) => Effect.succeed(definitions[path] ?? ""),
  };
  const requests: SemanticLintEvaluationRequest[] = [];
  const delegate = successfulEvaluator();
  const evaluator: SemanticLintEvaluation = {
    evaluate(request, options) {
      requests.push(request);
      return delegate.evaluate(request, options);
    },
  };
  const outcome = await Effect.runPromise(
    evaluateSemanticLint(
      {
        evidence: repositoryEvidence(["src/item.ts"], {
          "src/item.ts": "export const item = 1;",
        }),
        options: {
          violationProbabilityThreshold: 0.7,
          outputFormat: "json",
          mode: "live",
        },
        config,
      },
      files,
      Effect.succeed(evaluator),
    ),
  );
  const finalRequests = requests.filter((request) =>
    Object.values(request.questions).some((question) =>
      JSON.stringify(question.instructions).includes(
        "Does the identified candidate violate the supplied semantic lint rule?",
      ),
    ),
  );
  const routedReport = jsonDocuments(outcome)
    .flatMap((document) => ("findings" in document ? [document] : []))
    .find((document) => document.source === "<routed-evidence>");
  expect(finalRequests).toHaveLength(1);
  expect(Object.keys(finalRequests[0]?.questions ?? {})).toHaveLength(2);
  expect(routedReport?.findings).toHaveLength(2);
  expect(routedReport?.usage).toEqual({
    input_tokens: requests.length,
    output_tokens: requests.length,
  });
});

test("source rules do not route through configuration-only changes", async () => {
  const rulePath = "rules/function-naming.md";
  const files: SemanticLintFileAccess = {
    findPaths: () => Effect.succeed([rulePath]),
    readText: () =>
      Effect.succeed(
        ruleSource("# Name functions by purpose\n\nUse clear function names."),
      ),
  };
  const evaluator: SemanticLintEvaluation = {
    evaluate: () =>
      failedEvaluation("configuration must not enter source routing"),
  };
  const outcomes = await Effect.runPromise(
    evaluateSemanticLint(
      {
        evidence: repositoryEvidence(["package.json"], {
          "package.json": "{}",
        }),
        options: {
          violationProbabilityThreshold: 0.7,
          outputFormat: "json",
          mode: "live",
        },
        config,
      },
      files,
      Effect.succeed(evaluator),
    ),
  );
  const findings = jsonDocuments(outcomes).flatMap((document) =>
    "findings" in document ? document.findings : [],
  );
  expect(findings).toMatchObject([
    {
      rulePath,
      classification: "not_applicable",
    },
  ]);
});

test("dry-run separates deterministic, review, and scoped semantic work", async () => {
  const definitions: Readonly<Record<string, string>> = {
    "rules/filenames/use-distinct-filenames.md": ruleSource(
      "# Use distinct filenames\n\nFilenames should be distinct.",
    ),
    "rules/simplicity/require-each-change-to-justify-its-complexity.md":
      ruleSource(
        "# Require each change to justify its complexity\n\nIdentify the requirement.",
      ),
    "rules/function-naming.md": ruleSource(
      "# Name functions by purpose\n\nUse clear function names.",
    ),
    "rules/ignored.md": ruleSource("# Ignore docs\n\nCheck docs.", [
      "docs/**/*.md",
    ]),
  };
  const files: SemanticLintFileAccess = {
    findPaths: () => Effect.succeed(Object.keys(definitions).toSorted()),
    readText: (path) => Effect.succeed(definitions[path] ?? ""),
  };
  const evaluator: SemanticLintEvaluation = {
    evaluate: () => failedEvaluation("dry-run must not call the evaluator"),
  };
  const evidence = repositoryEvidence(
    ["src/item.ts", "other/item.ts"],
    {
      "src/item.ts": "export function item() { return 1; }",
      "other/item.ts": "export const other = 2;",
    },
    ["src/item.ts"],
  );
  const outcomes = await Effect.runPromise(
    evaluateSemanticLint(
      {
        evidence,
        options: {
          violationProbabilityThreshold: 0.7,
          outputFormat: "text",
          mode: "dry-run",
        },
        config,
      },
      files,
      Effect.succeed(evaluator),
    ),
  );
  const documents = jsonDocuments(outcomes);
  const report = documents.find((document) => "findings" in document);
  const plan = documents.find((document) => "kind" in document);
  expect(
    report && "findings" in report
      ? report.findings.map((finding) => finding.classification)
      : [],
  ).toEqual(["violation", "insufficient_evidence"]);
  expect(
    plan && "kind" in plan ? plan.rules.map((rule) => rule.rulePath) : [],
  ).toEqual(["rules/function-naming.md"]);
  expect(plan && "kind" in plan ? plan.layers : []).toEqual([
    "domain-choice",
    "path-choice",
    "hunk-choice",
    "context-expansion",
    "relevance-nouls",
    "rule-evaluation",
  ]);
  expect(plan && "kind" in plan ? plan.diffFiles : []).toMatchObject([
    {
      path: "src/item.ts",
      status: "untracked",
    },
  ]);
});

test("semantic findings include the evaluated source span", async () => {
  const rulePath = "rules/function-naming.md";
  const files: SemanticLintFileAccess = {
    findPaths: () => Effect.succeed([rulePath]),
    readText: () =>
      Effect.succeed(
        ruleSource("# Name functions by purpose\n\nUse clear function names."),
      ),
  };
  const evaluator = successfulEvaluator();
  const evidence = repositoryEvidence(["src/item.ts"], {
    "src/item.ts": "export function x() { return 1; }",
  });
  const outcomes = await Effect.runPromise(
    evaluateSemanticLint(
      {
        evidence,
        options: {
          violationProbabilityThreshold: 0.7,
          outputFormat: "json",
          mode: "live",
        },
        config,
      },
      files,
      Effect.succeed(evaluator),
    ),
  );
  const findings = jsonDocuments(outcomes).flatMap((document) =>
    "findings" in document ? document.findings : [],
  );
  expect(findings[0]?.classification).toBe("violation");
  expect(findings[0]?.evidence[0]).toMatchObject({
    path: "src/item.ts",
    startLine: 1,
    endLine: 1,
  });
});

test("supplied review context makes review rules evaluable", async () => {
  const rulePath =
    "rules/simplicity/require-each-change-to-justify-its-complexity.md";
  const files: SemanticLintFileAccess = {
    findPaths: () => Effect.succeed([rulePath]),
    readText: () =>
      Effect.succeed(
        ruleSource(
          "# Require each change to justify its complexity\n\nIdentify the requirement.",
        ),
      ),
  };
  const evaluator: SemanticLintEvaluation = {
    evaluate: () => failedEvaluation("dry-run must not call the evaluator"),
  };
  const evidence = {
    ...repositoryEvidence(["src/item.ts"], {
      "src/item.ts": "export const item = 1;",
    }),
    reviewContext: {
      path: "review-context.txt",
      language: "text",
      source: "Requirement: expose one item value.",
    },
  };
  const outcomes = await Effect.runPromise(
    evaluateSemanticLint(
      {
        evidence,
        options: {
          violationProbabilityThreshold: 0.7,
          outputFormat: "text",
          mode: "dry-run",
        },
        config,
      },
      files,
      Effect.succeed(evaluator),
    ),
  );
  const documents = jsonDocuments(outcomes);
  expect(documents).toHaveLength(1);
  expect(documents[0]).toMatchObject({
    kind: "dry-run-plan",
    rules: [
      {
        rulePath,
        evaluator: "review",
        scope: "change",
      },
    ],
  });
});

test("byte truncation preserves complete UTF-8 characters", () => {
  expect(truncateBytes("ab😀c", 4)).toBe("ab\n[truncated]");
});

test("a none Choice stops routing before evidence evaluation", async () => {
  const rulePath = "rules/function-naming.md";
  const files: SemanticLintFileAccess = {
    findPaths: () => Effect.succeed([rulePath]),
    readText: () =>
      Effect.succeed(
        ruleSource("# Name functions by purpose\n\nUse clear function names."),
      ),
  };
  const delegate = successfulEvaluator(() => "none");
  let requestCount = 0;
  const evaluator: SemanticLintEvaluation = {
    evaluate(request, options) {
      requestCount += 1;
      return delegate.evaluate(request, options);
    },
  };
  const outcomes = await Effect.runPromise(
    evaluateSemanticLint(
      {
        evidence: repositoryEvidence(
          ["src/first.ts", "src/second.ts"],
          {
            "src/first.ts": "export const first = 1;",
            "src/second.ts": "export const second = 2;",
          },
          ["src/first.ts", "src/second.ts"],
        ),
        options: {
          violationProbabilityThreshold: 0.7,
          outputFormat: "json",
          mode: "live",
        },
        config,
      },
      files,
      Effect.succeed(evaluator),
    ),
  );
  const findings = jsonDocuments(outcomes).flatMap((document) =>
    "findings" in document ? document.findings : [],
  );
  expect(requestCount).toBe(1);
  expect(findings[0]?.classification).toBe("not_applicable");
});

test("live evaluation bounds concurrent TypeSafe requests", async () => {
  const definitions: Readonly<Record<string, string>> = {
    "rules/first.md": ruleSource("# First rule\n\nCheck the first rule.", [
      "src/first.ts",
      "src/second.ts",
    ]),
    "rules/second.md": ruleSource("# Second rule\n\nCheck the second rule.", [
      "src/second.ts",
      "src/third.ts",
    ]),
    "rules/third.md": ruleSource("# Third rule\n\nCheck the third rule.", [
      "src/first.ts",
      "src/third.ts",
    ]),
  };
  const files: SemanticLintFileAccess = {
    findPaths: () => Effect.succeed(Object.keys(definitions)),
    readText: (path) => Effect.succeed(definitions[path] ?? ""),
  };
  const delegate = successfulEvaluator();
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  const requestStates: string[] = [];
  const evaluator: SemanticLintEvaluation = {
    evaluate(request, options) {
      return Effect.suspend(() => {
        activeRequests += 1;
        requestStates.push(JSON.stringify(request.state));
        maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
        return Effect.ensuring(
          Effect.andThen(
            Effect.sleep("10 millis"),
            delegate.evaluate(request, options),
          ),
          Effect.sync(() => {
            activeRequests -= 1;
          }),
        );
      });
    },
  };
  const boundedConfig: SemanticLintConfiguration = {
    ...config,
    routing: {
      ...config.routing,
      maximumConcurrentRequests: 2,
    },
  };
  await Effect.runPromise(
    evaluateSemanticLint(
      {
        evidence: repositoryEvidence(
          ["src/first.ts", "src/second.ts", "src/third.ts"],
          {
            "src/first.ts": "export const first = 1;",
            "src/second.ts": "export const second = 2;",
            "src/third.ts": "export const third = 3;",
          },
          ["src/first.ts", "src/second.ts", "src/third.ts"],
        ),
        options: {
          violationProbabilityThreshold: 0.7,
          outputFormat: "json",
          mode: "live",
        },
        config: boundedConfig,
      },
      files,
      Effect.succeed(evaluator),
    ),
  );
  expect(new Set(requestStates.slice(0, 3)).size).toBe(3);
  expect(maximumActiveRequests).toBe(2);
});
