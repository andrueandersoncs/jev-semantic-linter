import type {
  Question,
  RequestOptions,
  SystemOneRequest,
  SystemOneResult,
} from "@typesafe-ai/sdk";
import type { TypeSafeEvaluationError } from "./semantic-lint-errors";
import type { Result } from "./result";

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
  ) => Promise<Result<SemanticLintEvaluationResponse, TypeSafeEvaluationError>>;
}>;
