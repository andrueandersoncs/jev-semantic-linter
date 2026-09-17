import type { NoulResponse } from "@typesafe-ai/sdk";
import {
  type Result,
  valuesFromResults,
} from "./semantic-lint-result";
import type { Finding, Rule } from "./semantic-lint-types";


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
    const status: Finding["status"] =
      answer.noul >= threshold
        ? "violation"
        : answer.noul <= passMaximum
          ? "pass"
          : "review";
    return {
      ok: true,
      value: { ...rule, probability: answer.noul, status },
    };
  });
  return valuesFromResults(findingResults);
}
