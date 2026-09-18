import type { Usage } from "@typesafe-ai/sdk";
import type { TypeSafeEvaluationError } from "../errors";
import type { SemanticLintEvaluation } from "../evaluator";
import type { SemanticLintConfiguration } from "../config";
import { collect, ok, type Result } from "../../result";
import { mergeRoutingUsage, type RoutingRequestContext } from "./choice";
import { repositoryRelations, type RepositoryRelations } from "./context";
import { routeAndEvaluateRule, type RoutedRuleResult } from "./evaluate-rule";
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

function limitEvaluationConcurrency(
  evaluator: SemanticLintEvaluation,
  maximumConcurrentRequests: number,
): SemanticLintEvaluation {
  const limit = Math.max(1, maximumConcurrentRequests);
  let activeRequests = 0;
  let nextWaiter = 0;
  const waiters: (() => void)[] = [];

  async function acquire(): Promise<void> {
    if (activeRequests < limit) {
      activeRequests += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  }

  function release(): void {
    const waiter = waiters[nextWaiter];
    if (waiter === undefined) {
      activeRequests -= 1;
      return;
    }
    nextWaiter += 1;
    waiter();
  }

  return {
    async evaluate(request, requestOptions) {
      await acquire();
      try {
        return await evaluator.evaluate(request, requestOptions);
      } finally {
        release();
      }
    },
  };
}

async function evaluateRules(
  rules: readonly SemanticLintRule[],
  evidence: SemanticLintRepositoryEvidence,
  relations: RepositoryRelations,
  context: RoutingRequestContext,
): Promise<Result<readonly RoutedRuleResult[], TypeSafeEvaluationError>> {
  const pending = rules.map((rule) =>
    routeAndEvaluateRule(rule, evidence, relations, context),
  );
  return collect(await Promise.all(pending));
}

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

export async function routeAndEvaluateRules(
  input: RouteRulesInput,
): Promise<Result<RoutingResult, TypeSafeEvaluationError>> {
  const {
    rules,
    evidence,
    config,
    modelName,
    requestOptions,
    evaluator,
    violationProbabilityThreshold,
  } = input;
  const context: RoutingRequestContext = {
    config: {
      ...config,
      probabilityThresholds: {
        ...config.probabilityThresholds,
        defaultViolationProbabilityThreshold: violationProbabilityThreshold,
      },
    },
    ...(modelName === undefined ? {} : { modelName }),
    evaluator: limitEvaluationConcurrency(
      evaluator,
      config.routing.maximumConcurrentRequests,
    ),
    requestOptions,
  };
  const relations = repositoryRelations(evidence);
  const results = await evaluateRules(rules, evidence, relations, context);
  if (!results.ok) {
    return results;
  }
  const fallbackModel = modelName ?? "jev-latest";
  const usage = mergeRoutingUsage(
    results.value.map((result) => result.usage),
    fallbackModel,
  );
  return ok({
    findings: results.value.flatMap((result) => result.findings),
    model: usage.model,
    usage: {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
    },
  });
}
