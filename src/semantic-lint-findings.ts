import type { NoulResponse } from "@typesafe-ai/sdk";
import type { SemanticLintEvidence } from "./semantic-lint-evidence";
import type { SemanticLintRoutingDecision } from "./routing/choice";
import type { SemanticLintRule } from "./semantic-lint-rules";
export type SemanticLintFinding = Readonly<{
  rulePath: string;
  ruleTitle: string;
  evaluator: SemanticLintRule["metadata"]["evaluator"];
  classification:
    | "violation"
    | "review"
    | "pass"
    | "not_applicable"
    | "insufficient_evidence";
  message: string;
  violationProbability?: number;
  evidence: readonly SemanticLintEvidence[];
  routing?: Readonly<{
    decisions: readonly SemanticLintRoutingDecision[];
    selectedEvidenceIds: readonly string[];
  }>;
}>;

function classificationFromProbability(
  probability: number,
  violationProbabilityThreshold: number,
  maximumPassProbability: number,
): SemanticLintFinding["classification"] {
  if (probability >= violationProbabilityThreshold) {
    return "violation";
  }
  return probability <= maximumPassProbability ? "pass" : "review";
}

export function findingFromAnswer(
  rule: SemanticLintRule,
  answer: NoulResponse,
  evidence: readonly SemanticLintEvidence[],
  violationProbabilityThreshold: number,
  maximumPassProbability: number,
): SemanticLintFinding {
  const classification = classificationFromProbability(
    answer.noul,
    violationProbabilityThreshold,
    maximumPassProbability,
  );
  return {
    rulePath: rule.rulePath,
    ruleTitle: rule.ruleTitle,
    evaluator: "semantic",
    classification,
    message:
      classification === "pass"
        ? "No concrete violation was found in this candidate."
        : "The candidate needs review against this rule.",
    violationProbability: answer.noul,
    evidence: classification === "pass" ? [] : evidence,
  };
}
