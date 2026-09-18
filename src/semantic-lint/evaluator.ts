import type {
  Question,
  RequestOptions,
  SystemOneRequest,
  SystemOneResult,
} from "@typesafe-ai/sdk";
import type { Effect } from "effect";
import type { TypeSafeEvaluationError } from "./errors";

export type SemanticLintQuestionSet = Readonly<Record<string, Question>>;

export type SemanticLintEvaluationRequest = Readonly<
  SystemOneRequest<SemanticLintQuestionSet>
>;

export type SemanticLintEvaluationResponse = Readonly<
  SystemOneResult<SemanticLintQuestionSet>
>;

export type SemanticLintEvaluation = Readonly<{
  evaluate: (
    request: SemanticLintEvaluationRequest,
    requestOptions: RequestOptions,
  ) => Effect.Effect<SemanticLintEvaluationResponse, TypeSafeEvaluationError>;
}>;
