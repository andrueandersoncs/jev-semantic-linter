import { TypeSafeClient } from "@typesafe-ai/sdk";
import { Effect } from "effect";
import { errorMessage } from "../../../error-message";
import { TypeSafeEvaluationError } from "../../errors";
import type { SemanticLintEvaluation } from "../../evaluator";
import { parseTypeSafeResponse } from "./response";

/** Creates one TypeSafe client for one live lint run. */
export const createSemanticLintEvaluator = Effect.map(
  Effect.try({
    try: () => new TypeSafeClient(),
    catch: (cause) =>
      new TypeSafeEvaluationError({
        message: `TypeSafe client setup failed: ${errorMessage(cause)}`,
        cause,
      }),
  }),
  (client): SemanticLintEvaluation => ({
    evaluate: (request, requestOptions) =>
      Effect.flatMap(
        Effect.tryPromise({
          try: () => client.systemOne(request, requestOptions),
          catch: (cause) =>
            new TypeSafeEvaluationError({
              message: `TypeSafe request failed: ${errorMessage(cause)}`,
              cause,
            }),
        }),
        parseTypeSafeResponse,
      ),
  }),
);
