import { Effect } from "effect";
import type { SemanticLintFileAccess } from "../runtime/files";
import { deterministicFindings } from "../deterministic";
import type { SemanticLintFailure } from "../errors";
import type { SemanticLintEvaluation } from "../evaluator";
import type { SemanticLintFinding } from "../findings";
import {
  semanticLintOutcome,
  type SemanticLintFindingReport,
  type SemanticLintOutcome,
} from "../report";
import { routeAndEvaluateRules, routingDryRunPlan } from "./route-rules";
import {
  ruleMatchesPath,
  rulesFromFiles,
  type SemanticLintRule,
} from "../rules";
import type { SemanticLintConfiguration, SemanticLintOptions } from "../config";
import type { SemanticLintRepositoryEvidence } from "../evidence";

type LintInput = Readonly<{
  evidence: SemanticLintRepositoryEvidence;
  options: SemanticLintOptions;
  config: SemanticLintConfiguration;
}>;

type RuleGroups = Readonly<{
  deterministic: readonly SemanticLintRule[];
  review: readonly SemanticLintRule[];
  semantic: readonly SemanticLintRule[];
}>;

function partitionRules(rules: readonly SemanticLintRule[]): RuleGroups {
  return {
    deterministic: rules.filter(
      (rule) => rule.metadata.evaluator === "deterministic",
    ),
    review: rules.filter((rule) => rule.metadata.evaluator === "review"),
    semantic: rules.filter((rule) => rule.metadata.evaluator === "semantic"),
  };
}

function unevaluatedReviewFindings(
  rules: readonly SemanticLintRule[],
): readonly SemanticLintFinding[] {
  return rules.map((rule) => ({
    rulePath: rule.rulePath,
    ruleTitle: rule.ruleTitle,
    evaluator: "review",
    classification: "insufficient_evidence",
    message: `Requires ${rule.metadata.requiredEvidence.join(" and ")}.`,
    evidence: [],
  }));
}

function staticReports(
  groups: RuleGroups,
  input: LintInput,
): readonly SemanticLintFindingReport[] {
  const findings = [
    ...deterministicFindings(groups.deterministic, input.evidence),
    ...(input.evidence.reviewContext === undefined
      ? unevaluatedReviewFindings(groups.review)
      : []),
  ];
  return findings.length === 0
    ? []
    : [
        {
          source: "<repository>",
          model: "local",
          violationProbabilityThreshold:
            input.options.violationProbabilityThreshold,
          findings,
        },
      ];
}

/** Evaluates one repository snapshot into a complete user-facing outcome. */
export function evaluateSemanticLint(
  input: LintInput,
  files: SemanticLintFileAccess,
  createEvaluator: Effect.Effect<SemanticLintEvaluation, SemanticLintFailure>,
): Effect.Effect<SemanticLintOutcome, SemanticLintFailure> {
  return Effect.gen(function* () {
    const loadedRules = yield* rulesFromFiles(files);
    const applicableRules = loadedRules.filter((rule) =>
      input.evidence.changedPaths.some((path) => ruleMatchesPath(rule, path)),
    );
    const groups = partitionRules(applicableRules);
    const reports = staticReports(groups, input);
    const routed =
      input.evidence.reviewContext === undefined
        ? groups.semantic
        : [...groups.semantic, ...groups.review];
    if (input.options.mode === "dry-run") {
      const plan = routingDryRunPlan(routed, input.evidence, input.config);
      return semanticLintOutcome(reports, plan, input.options);
    }
    if (routed.length === 0) {
      return semanticLintOutcome(reports, undefined, input.options);
    }
    const evaluator = yield* createEvaluator;
    const result = yield* routeAndEvaluateRules({
      rules: routed,
      evidence: input.evidence,
      config: input.config,
      modelName: input.options.modelName,
      requestOptions: {},
      evaluator,
      violationProbabilityThreshold:
        input.options.violationProbabilityThreshold,
    });
    const routedReport: SemanticLintFindingReport = {
      source: "<routed-evidence>",
      model: result.model,
      findings: result.findings,
      violationProbabilityThreshold:
        input.options.violationProbabilityThreshold,
      usage: result.usage,
    };
    return semanticLintOutcome(
      [...reports, routedReport],
      undefined,
      input.options,
    );
  });
}
