import { expect, test } from "bun:test";
import type { NoulResponse } from "@typesafe-ai/sdk";
import { Effect } from "effect";
import { TypeSafeEvaluationError } from "../errors";
import type {
  SemanticLintEvaluation,
  SemanticLintEvaluationRequest,
} from "../evaluator";
import { batchedSemanticLintEvaluation } from "./batch";

test("batches same-state questions and returns each caller's answer", async () => {
  const requests: SemanticLintEvaluationRequest[] = [];
  const evaluator: SemanticLintEvaluation = {
    evaluate: (request) => {
      requests.push(request);
      const answers = Object.fromEntries(
        Object.entries(request.questions).map(([id, question]) => [
          id,
          {
            type: "noul" as const,
            noul: question.instructions === "first" ? 0.1 : 0.9,
          },
        ]),
      );
      return Effect.succeed({
        model: "test-model",
        answers,
        usage: { input_tokens: 5, output_tokens: 3 },
      });
    },
  };
  const batched = batchedSemanticLintEvaluation(evaluator, 32_000, 1);
  const requestOptions = {};
  const responses = await Effect.runPromise(
    Effect.all(
      [
        batched.evaluate(
          {
            state: { shared: true },
            questions: {
              answer: { type: "noul", instructions: "first" },
            },
          },
          requestOptions,
        ),
        batched.evaluate(
          {
            state: { shared: true },
            questions: {
              answer: { type: "noul", instructions: "second" },
            },
          },
          requestOptions,
        ),
      ],
      { concurrency: "unbounded" },
    ),
  );
  expect(requests).toHaveLength(1);
  expect(Object.keys(requests[0]?.questions ?? {})).toHaveLength(2);
  expect(
    responses.map((response) => (response.answers.answer as NoulResponse).noul),
  ).toEqual([0.1, 0.9]);
  expect(
    responses.reduce(
      (total, response) => total + response.usage.input_tokens,
      0,
    ),
  ).toBe(5);
  expect(
    responses.reduce(
      (total, response) => total + response.usage.output_tokens,
      0,
    ),
  ).toBe(3);
});

test("splits shared-state questions at the request byte limit", async () => {
  const requests: SemanticLintEvaluationRequest[] = [];
  const question = { type: "noul" as const, instructions: "x".repeat(200) };
  const state = { shared: true };
  const maximumRequestBytes = Buffer.byteLength(
    JSON.stringify({ state, questions: { q1: question, q2: question } }),
  );
  const evaluator: SemanticLintEvaluation = {
    evaluate: (request) => {
      requests.push(request);
      const answers = Object.fromEntries(
        Object.keys(request.questions).map((id) => [
          id,
          { type: "noul" as const, noul: 0.5 },
        ]),
      );
      return Effect.succeed({
        model: "test-model",
        answers,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  };
  const batched = batchedSemanticLintEvaluation(
    evaluator,
    maximumRequestBytes,
    1,
  );
  const requestOptions = {};
  await Effect.runPromise(
    Effect.all(
      Array.from({ length: 3 }, () =>
        batched.evaluate(
          { state, questions: { answer: question } },
          requestOptions,
        ),
      ),
      { concurrency: "unbounded" },
    ),
  );
  expect(requests).toHaveLength(2);
  expect(
    requests.every(
      (request) =>
        Buffer.byteLength(JSON.stringify(request)) <= maximumRequestBytes,
    ),
  ).toBeTrue();
});

test("fails every caller when a shared request fails", async () => {
  let requestCount = 0;
  const evaluator: SemanticLintEvaluation = {
    evaluate: () => {
      requestCount += 1;
      return Effect.fail(
        new TypeSafeEvaluationError({ message: "shared request failed" }),
      );
    },
  };
  const batched = batchedSemanticLintEvaluation(evaluator, 32_000, 1);
  const requestOptions = {};
  const error = await Effect.runPromise(
    Effect.flip(
      Effect.all(
        ["first", "second"].map((instructions) =>
          batched.evaluate(
            {
              state: { shared: true },
              questions: { answer: { type: "noul", instructions } },
            },
            requestOptions,
          ),
        ),
        { concurrency: "unbounded" },
      ),
    ),
  );
  expect(requestCount).toBe(1);
  expect(error).toMatchObject({
    _tag: "TypeSafeEvaluationError",
    message: "shared request failed",
  });
});
