import { Glob } from "bun";
import { noul } from "@typesafe-ai/sdk";
import { errorMessage } from "./error-message";
import {
  type Result,
  valuesFromResults,
} from "./semantic-lint-result";
import { textFromFile } from "./text-from-file";
import type {
  Configuration,
  QuestionSet,
  Rule,
} from "./semantic-lint-types";

async function rulePaths(pattern: string): Promise<Result<readonly string[]>> {
  try {
    const glob = new Glob(pattern);
    const scannedPaths = glob.scan(".");
    const paths = await Array.fromAsync(scannedPaths);
    const sortedPaths = paths.toSorted();
    return { ok: true, value: sortedPaths };
  } catch (error) {
    const message = errorMessage(error);
    return {
      ok: false,
      error: `Could not discover rule files: ${message}`,
    };
  }
}

export async function rulesFromFiles(
  config: Configuration["rules"],
): Promise<Result<readonly Rule[]>> {
  const paths = await rulePaths(config.pattern);
  if (!paths.ok) {
    return paths;
  }
  if (paths.value.length === config.emptyLength) {
    return { ok: false, error: `No rule files match ${config.pattern}` };
  }

  const rulePromises = paths.value.map(
    async (path, index): Promise<Result<Rule>> => {
      const contents = await textFromFile(path, config.fileLabel);
      if (!contents.ok) {
        return contents;
      }

      const text = contents.value.trim();
      if (text.length === config.emptyLength) {
        return { ok: false, error: `Rule file is empty: ${path}` };
      }

      const headingMatch = text.match(/^#\s+(.+)$/m);
      const [, heading] = headingMatch ?? [];
      const trimmedHeading = heading?.trim();
      const title = trimmedHeading ?? path;
      const ordinal = index + config.firstOrdinal;
      const id = `${config.idPrefix}${ordinal}`;
      return {
        ok: true,
        value: { id, path, title, text },
      };
    },
  );
  const loaded = await Promise.all(rulePromises);
  return valuesFromResults(loaded);
}

export function questionsFromRules(
  rules: readonly Rule[],
  config: Configuration["question"],
): QuestionSet {
  const entries = rules.map((rule) => {
    const instructions = {
      task: config.task,
      rule: {
        source: rule.path,
        definition: rule.text,
      },
      guidance: config.guidance,
    };
    const criteria = {
      true: config.violation,
      false: config.compliance,
    };
    const question = noul(instructions, criteria);
    return [rule.id, question] as const;
  });
  return Object.fromEntries(entries);
}
