import { TypeSafeClient } from "@typesafe-ai/sdk";
import { errorMessage } from "../../../error-message";
import type { TypeSafeEvaluationError } from "../../errors";
import type { SemanticLintEvaluation } from "../../evaluator";
import { fail, ok, type Result } from "../../../result";
import { parseTypeSafeResponse } from "./response";
/** Creates one TypeSafe client for one live lint run. */
export function createSemanticLintEvaluator(): Result<
  SemanticLintEvaluation,
  TypeSafeEvaluationError
> {
  try {
    const client = new TypeSafeClient();
    return ok({
      async evaluate(request, requestOptions) {
        try {
          return parseTypeSafeResponse(
            await client.systemOne(request, requestOptions),
          );
        } catch (cause) {
          return fail({
            tag: "TypeSafeEvaluationError",
            message: `TypeSafe request failed: ${errorMessage(cause)}`,
            cause,
          });
        }
      },
    });
  } catch (cause) {
    return fail({
      tag: "TypeSafeEvaluationError",
      message: `TypeSafe client setup failed: ${errorMessage(cause)}`,
      cause,
    });
  }
}
