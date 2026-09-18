import { expect, test } from "bun:test";
import { Effect } from "effect";
import { parseTypeSafeResponse } from "./response";

test("rejects out-of-range TypeSafe probabilities", async () => {
  const error = await Effect.runPromise(
    Effect.flip(
      parseTypeSafeResponse({
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
      }),
    ),
  );
  expect(error).toMatchObject({ _tag: "TypeSafeEvaluationError" });
});
