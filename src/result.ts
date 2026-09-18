export type Result<T, E> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function fail<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function collect<T, E>(
  results: readonly Result<T, E>[],
): Result<readonly T[], E> {
  const failure = results.find((result) => !result.ok);
  if (failure !== undefined && !failure.ok) {
    return failure;
  }
  return ok(results.flatMap((result) => (result.ok ? [result.value] : [])));
}
