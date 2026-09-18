import { Data } from "effect";

export class GitAccessError extends Data.TaggedError("GitAccessError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class FileAccessError extends Data.TaggedError("FileAccessError")<{
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class InvalidArgumentsError extends Data.TaggedError(
  "InvalidArgumentsError",
)<{
  readonly message: string;
}> {}

export class RuleFileError extends Data.TaggedError("RuleFileError")<{
  readonly path: string;
  readonly message: string;
}> {}

export class TypeSafeEvaluationError extends Data.TaggedError(
  "TypeSafeEvaluationError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type SemanticLintFailure =
  | GitAccessError
  | FileAccessError
  | InvalidArgumentsError
  | RuleFileError
  | TypeSafeEvaluationError;
