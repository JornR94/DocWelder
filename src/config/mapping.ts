import { readFileSync } from 'node:fs';
import { Minimatch } from 'minimatch';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';
import { ConfigValidationError, zodIssuesToConfigDetails } from './errors.js';

const MappingEntrySchema = z
  .object({
    code_path: z.string().min(1),
    wiki_path: z.string().min(1),
  })
  .strict();

const MappingFileSchema = z
  .object({
    mappings: z.array(MappingEntrySchema).default([]),
  })
  .strict();

export type MappingEntry = z.infer<typeof MappingEntrySchema>;
export type MappingFile = z.infer<typeof MappingFileSchema>;

const MAPPING_RELATIVE_PATH = '.docs/mapping.yaml';

/**
 * Minimatch itself never throws on malformed glob syntax (it degrades to
 * literal matching), so unbalanced bracket/brace groups are checked manually.
 */
function isValidGlob(pattern: string): boolean {
  if (pattern.trim().length === 0) return false;
  let brackets = 0;
  let braces = 0;
  for (const ch of pattern) {
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (brackets < 0 || braces < 0) return false;
  }
  return brackets === 0 && braces === 0;
}

/** Parses and validates `.docs/mapping.yaml`, failing fast per the same contract as `config.yaml`. */
export function parseMapping(raw: string, filePath: string = MAPPING_RELATIVE_PATH): MappingFile {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    if (err instanceof YAMLParseError) {
      throw new ConfigValidationError(filePath, [
        { line: err.linePos?.[0]?.line, message: err.message },
      ]);
    }
    throw new ConfigValidationError(filePath, [{ message: String(err) }]);
  }

  const result = MappingFileSchema.safeParse(parsed ?? {});
  if (!result.success) {
    throw new ConfigValidationError(filePath, zodIssuesToConfigDetails(result.error.issues));
  }

  const details: { field?: string; message: string }[] = [];
  const seenCodePaths = new Set<string>();
  result.data.mappings.forEach((entry, index) => {
    if (!isValidGlob(entry.code_path)) {
      details.push({
        field: `mappings[${index}].code_path`,
        message: `"${entry.code_path}" is not a valid glob pattern`,
      });
    }
    if (seenCodePaths.has(entry.code_path)) {
      details.push({
        field: `mappings[${index}].code_path`,
        message: `duplicate code_path "${entry.code_path}" (already mapped by an earlier entry)`,
      });
    }
    seenCodePaths.add(entry.code_path);
  });
  if (details.length > 0) {
    throw new ConfigValidationError(filePath, details);
  }

  return result.data;
}

export function loadMapping(filePath: string = MAPPING_RELATIVE_PATH): MappingFile {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new ConfigValidationError(filePath, [
      { message: `Unable to read file: ${err instanceof Error ? err.message : String(err)}` },
    ]);
  }
  return parseMapping(raw, filePath);
}

/** Returns the mapping entry whose `code_path` glob matches `relativePath`, if any. */
export function findMappingForPath(
  mapping: MappingFile,
  relativePath: string,
): MappingEntry | undefined {
  return mapping.mappings.find((entry) => new Minimatch(entry.code_path).match(relativePath));
}
