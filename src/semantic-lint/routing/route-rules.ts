import type { Usage } from "@typesafe-ai/sdk";
import { Effect } from "effect";
import type { TypeSafeEvaluationError } from "../errors";
import type { SemanticLintEvaluation } from "../evaluator";
import type { SemanticLintConfiguration } from "../config";
import { batchedSemanticLintEvaluation } from "./batch";
import { mergeRoutingUsage, type RoutingRequestContext } from "./choice";
import { repositoryRelations } from "./context";
import { routeAndEvaluateRule } from "./evaluate-rule";
import type {
  SemanticLintDiffFile,
  SemanticLintRepositoryEvidence,
} from "../evidence";
import type { SemanticLintFinding } from "../findings";
import type { SemanticLintRule } from "../rules";
export type SemanticLintDryRunPlan = Readonly<{
  kind: "dry-run-plan";
  layers: readonly [
    "domain-choice",
    "path-choice",
    "hunk-choice",
    "context-expansion",
    "relevance-nouls",
    "rule-evaluation",
  ];
  rules: readonly Readonly<{
    rulePath: string;
    evaluator: SemanticLintRule["metadata"]["evaluator"];
    scope: SemanticLintRule["metadata"]["scope"];
  }>[];
  diffFiles: readonly Readonly<{
    id: string;
    path: string;
    status: SemanticLintDiffFile["status"];
    hunks: readonly Readonly<{
      id: string;
      header: string;
      startLine: number;
      endLine: number;
    }>[];
  }>[];
  limits: SemanticLintConfiguration["routing"];
}>;

type RoutingResult = Readonly<{
  findings: readonly SemanticLintFinding[];
  model: string;
  usage: Usage;
}>;
type RouteRulesInput = Readonly<{
  rules: readonly SemanticLintRule[];
  evidence: SemanticLintRepositoryEvidence;
  config: SemanticLintConfiguration;
  modelName?: string;
  requestOptions: RoutingRequestContext["requestOptions"];
  evaluator: SemanticLintEvaluation;
  violationProbabilityThreshold: number;
}>;

export function routingDryRunPlan(
  rules: readonly SemanticLintRule[],
  evidence: SemanticLintRepositoryEvidence,
  config: SemanticLintConfiguration,
): SemanticLintDryRunPlan {
  return {
    kind: "dry-run-plan",
    layers: [
      "domain-choice",
      "path-choice",
      "hunk-choice",
      "context-expansion",
      "relevance-nouls",
      "rule-evaluation",
    ],
    rules: rules.map((rule) => ({
      rulePath: rule.rulePath,
      evaluator: rule.metadata.evaluator,
      scope: rule.metadata.scope,
    })),
    diffFiles: evidence.diffFiles.map((file) => ({
      id: file.id,
      path: file.path,
      status: file.status,
      hunks: file.hunks.map((hunk) => {
        const usesOldLines = hunk.newLineCount === 0;
        const startLine = usesOldLines ? hunk.oldStartLine : hunk.newStartLine;
        const lineCount = usesOldLines ? hunk.oldLineCount : hunk.newLineCount;
        return {
          id: hunk.id,
          header: hunk.header,
          startLine,
          endLine: startLine + lineCount - 1,
        };
      }),
    })),
    limits: config.routing,
  };
}

export function routeAndEvaluateRules(
  input: RouteRulesInput,
): Effect.Effect<RoutingResult, TypeSafeEvaluationError> {
  const {
    rules,
    evidence,
    config,
    modelName,
    requestOptions,
    evaluator,
    violationProbabilityThreshold,
  } = input;
  const batchedEvaluator = batchedSemanticLintEvaluation(
    evaluator,
    config.evidence.maximumEvaluationRequestBytes,
    config.routing.maximumConcurrentRequests,
  );
  const context: RoutingRequestContext = {
    config: {
      ...config,
      probabilityThresholds: {
        ...config.probabilityThresholds,
        defaultViolationProbabilityThreshold: violationProbabilityThreshold,
      },
    },
    ...(modelName === undefined ? {} : { modelName }),
    evaluator: batchedEvaluator,
    requestOptions,
  };
  const relations = repositoryRelations(evidence);
  return Effect.map(
    Effect.forEach(
      rules,
      (rule) => routeAndEvaluateRule(rule, evidence, relations, context),
      { concurrency: "unbounded" },
    ),
    (results) => {
      const fallbackModel = modelName ?? "jev-latest";
      const usage = mergeRoutingUsage(
        results.map((result) => result.usage),
        fallbackModel,
      );
      return {
        findings: results.flatMap((result) => result.findings),
        model: usage.model,
        usage: {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
        },
      };
    },
  );
}
