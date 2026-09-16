import type { NoulResponse } from "@typesafe-ai/sdk";
import {
  type Result,
  valuesFromResults,
} from "./semantic-lint-result";
import type { Finding, Rule } from "./semantic-lint-types";

function findingFromAnswer(
  rule: Rule,
  answer: NoulResponse,
  threshold: number,
  passMaximum: number,
): Finding {
  const belowThresholdStatus: Finding["status"] =
    answer.noul <= passMaximum ? "pass" : "review";
  const status: Finding["status"] =
    answer.noul >= threshold ? "violation" : belowThresholdStatus;
  return { ...rule, probability: answer.noul, status };
}

export function findingsFromAnswers(
  rules: readonly Rule[],
  answers: Readonly<Record<string, NoulResponse>>,
  threshold: number,
  passMaximum: number,
): Result<readonly Finding[]> {
  const findingResults = rules.map((rule): Result<Finding> => {
    const answer = answers[rule.id];
    if (!answer) {
      return {
        ok: false,
        error: `TypeSafe returned no answer for ${rule.id}`,
      };
    }
    const finding = findingFromAnswer(
      rule,
      answer,
      threshold,
      passMaximum,
    );
    return { ok: true, value: finding };
  });
  return valuesFromResults(findingResults);
}
