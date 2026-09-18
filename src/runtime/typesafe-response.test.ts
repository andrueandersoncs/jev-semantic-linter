import { expect, test } from "bun:test";
import { parseTypeSafeResponse } from "./typesafe-response";

test("rejects out-of-range TypeSafe probabilities", () => {
  const result = parseTypeSafeResponse({
    model: "test-model",
    answers: {
      route: {
        type: "choice",
        choice: "file_1",
        confidence: 0.9,
        probabilities: { file_1: 1.2 },
      },
    },
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  expect(result).toMatchObject({
    ok: false,
    error: { tag: "TypeSafeEvaluationError" },
  });
});
