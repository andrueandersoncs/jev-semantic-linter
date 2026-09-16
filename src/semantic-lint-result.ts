export type Result<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: string }>;

export function valuesFromResults<T>(
  results: readonly Result<T>[],
): Result<readonly T[]> {
  return results.reduce<Result<readonly T[]>>(
    (collected, result) => {
      if (!collected.ok) {
        return collected;
      }
      if (!result.ok) {
        return result;
      }
      return {
        ok: true,
        value: [...collected.value, result.value],
      };
    },
    { ok: true, value: [] },
  );
}
