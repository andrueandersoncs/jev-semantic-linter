import type { SemanticLintFileAccess } from "../runtime/semantic-lint-files";
import { deterministicFindings } from "../semantic-lint-deterministic";
import type { SemanticLintFailure } from "../semantic-lint-errors";
import type { SemanticLintEvaluation } from "../semantic-lint-evaluator";
import { ok, type Result } from "../result";
import type { SemanticLintFinding } from "../semantic-lint-findings";
import {
  semanticLintOutcome,
  type SemanticLintFindingReport,
  type SemanticLintOutcome,
} from "../semantic-lint-report";
import { routeAndEvaluateRules, routingDryRunPlan } from "./route-rules";
import { rulesFromFiles, type SemanticLintRule } from "../semantic-lint-rules";
import type {
  SemanticLintConfiguration,
  SemanticLintOptions,
} from "../semantic-lint-config";
import type { SemanticLintRepositoryEvidence } from "../semantic-lint-evidence";

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

/**
 * Evaluates one repository snapshot and returns the complete user-facing outcome.
 * The evaluator factory is lazy, so dry runs perform no network setup.
 */
export async function evaluateSemanticLint(
  input: LintInput,
  files: SemanticLintFileAccess,
  createEvaluator: () => Result<SemanticLintEvaluation, SemanticLintFailure>,
): Promise<Result<SemanticLintOutcome, SemanticLintFailure>> {
  const loadedRules = await rulesFromFiles(files, input.config.ruleFiles);
  if (!loadedRules.ok) {
    return loadedRules;
  }
  const groups = partitionRules(loadedRules.value);
  const reports = staticReports(groups, input);
  const routed =
    input.evidence.reviewContext === undefined
      ? groups.semantic
      : [...groups.semantic, ...groups.review];
  if (input.options.mode === "dry-run") {
    const plan = routingDryRunPlan(routed, input.evidence, input.config);
    return ok(semanticLintOutcome(reports, plan, input.options, input.config));
  }
  if (routed.length === 0) {
    return ok(
      semanticLintOutcome(reports, undefined, input.options, input.config),
    );
  }
  const evaluator = createEvaluator();
  if (!evaluator.ok) {
    return evaluator;
  }
  const result = await routeAndEvaluateRules({
    rules: routed,
    evidence: input.evidence,
    config: input.config,
    modelName: input.options.modelName,
    requestOptions: {},
    evaluator: evaluator.value,
    violationProbabilityThreshold: input.options.violationProbabilityThreshold,
  });
  if (!result.ok) {
    return result;
  }
  const routedReport: SemanticLintFindingReport = {
    source: "<routed-evidence>",
    model: result.value.model,
    findings: result.value.findings,
    violationProbabilityThreshold: input.options.violationProbabilityThreshold,
    usage: result.value.usage,
  };
  return ok(
    semanticLintOutcome(
      [...reports, routedReport],
      undefined,
      input.options,
      input.config,
    ),
  );
}
