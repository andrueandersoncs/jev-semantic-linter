import { dirname, extname, join, posix } from "node:path";
import type { SemanticLintSource } from "./evidence";

export const codeExtensions: Readonly<Record<string, true>> = {
  ".ts": true,
  ".tsx": true,
  ".js": true,
  ".jsx": true,
  ".mjs": true,
  ".cjs": true,
};

const scanners: Readonly<Record<string, Bun.Transpiler>> = {
  ".ts": new Bun.Transpiler({ loader: "ts" }),
  ".tsx": new Bun.Transpiler({ loader: "tsx" }),
  ".js": new Bun.Transpiler({ loader: "js" }),
  ".jsx": new Bun.Transpiler({ loader: "jsx" }),
  ".mjs": new Bun.Transpiler({ loader: "js" }),
  ".cjs": new Bun.Transpiler({ loader: "js" }),
};

export function importSpecifiers(file: SemanticLintSource): readonly string[] {
  const scanner = scanners[extname(file.path)];
  if (!scanner) {
    return [];
  }
  try {
    return scanner.scan(file.source).imports.map((item) => item.path);
  } catch {
    return [];
  }
}

export function resolvedRelativeImport(
  sourcePath: string,
  specifier: string,
  sourcePaths: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const base = posix.normalize(join(dirname(sourcePath), specifier));
  const candidates = [
    base,
    ...Object.keys(codeExtensions).map((extension) => `${base}${extension}`),
    ...Object.keys(codeExtensions).map((extension) =>
      posix.join(base, `index${extension}`),
    ),
  ];
  return candidates.find((candidate) => sourcePaths.has(candidate));
}
