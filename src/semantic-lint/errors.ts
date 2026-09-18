export type GitAccessError = Readonly<{
  tag: "GitAccessError";
  operation: string;
  message: string;
  cause?: unknown;
}>;

export type FileAccessError = Readonly<{
  tag: "FileAccessError";
  path: string;
  message: string;
  cause?: unknown;
}>;

export type InvalidArgumentsError = Readonly<{
  tag: "InvalidArgumentsError";
  message: string;
}>;

export type RuleFileError = Readonly<{
  tag: "RuleFileError";
  path: string;
  message: string;
}>;

export type TypeSafeEvaluationError = Readonly<{
  tag: "TypeSafeEvaluationError";
  message: string;
  cause?: unknown;
}>;

export type SemanticLintFailure =
  | GitAccessError
  | FileAccessError
  | InvalidArgumentsError
  | RuleFileError
  | TypeSafeEvaluationError;
