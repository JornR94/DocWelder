import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';
import { ConfigValidationError, zodIssuesToConfigDetails } from './errors.js';

/**
 * `~/.config/docwelder/config.yaml` — per-machine identity and secrets for
 * local commands only (spec `user-config`). Never read by `propose`/`publish`
 * (those read CI variables exclusively), and never committed to a repo.
 */
export const UserConfigSchema = z
  .object({
    wikiBackend: z
      .object({
        type: z.literal('azure-devops-wiki').default('azure-devops-wiki'),
        organization: z.string().min(1),
        project: z.string().min(1),
        wikiIdentifier: z.string().min(1),
        personalAccessToken: z.string().min(1),
      })
      .strict(),
    llmProvider: z
      .object({
        type: z.literal('openrouter').default('openrouter'),
        apiKey: z.string().min(1),
        /** Personal default model override; falls back to the image default when null. */
        model: z.string().min(1).nullable().default(null),
      })
      .strict(),
  })
  .strict();

export type UserConfig = z.infer<typeof UserConfigSchema>;

const SECRET_FIELD_PATHS = ['wikiBackend.personalAccessToken', 'llmProvider.apiKey'] as const;

export function userConfigPath(): string {
  return join(homedir(), '.config', 'docwelder', 'config.yaml');
}

export function parseUserConfig(raw: string, filePath: string = userConfigPath()): UserConfig {
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

  const result = UserConfigSchema.safeParse(parsed ?? {});
  if (!result.success) {
    throw new ConfigValidationError(filePath, zodIssuesToConfigDetails(result.error.issues));
  }
  return result.data;
}

export function loadUserConfig(filePath: string = userConfigPath()): UserConfig | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    if (isEnoent(err)) return null;
    throw new ConfigValidationError(filePath, [
      { message: `Unable to read file: ${err instanceof Error ? err.message : String(err)}` },
    ]);
  }
  return parseUserConfig(raw, filePath);
}

/** Writes with mode 0600 (spec: "permissions restricted to the current user"). POSIX only. */
export function saveUserConfig(config: UserConfig, filePath: string = userConfigPath()): void {
  UserConfigSchema.parse(config); // re-validate before persisting
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, stringifyYaml(config), { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

/** Deep-masks every secret field for display during `init-user`'s re-run confirmation flow. */
export function maskSecrets(config: UserConfig): Record<string, unknown> {
  const masked = structuredClone(config) as Record<string, unknown>;
  for (const path of SECRET_FIELD_PATHS) {
    const [section, field] = path.split('.') as [string, string];
    const sectionObj = masked[section] as Record<string, unknown> | undefined;
    const value = sectionObj?.[field];
    if (typeof value === 'string' && value.length > 0) {
      sectionObj![field] = maskValue(value);
    }
  }
  return masked;
}

function maskValue(value: string): string {
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
}

/**
 * Spec `user-config`: "emits a warning if `~/.config/docwelder/config.yaml`
 * is world-readable". Returns `true` when a warning should be shown.
 */
export function isWorldReadable(filePath: string = userConfigPath()): boolean {
  try {
    const mode = statSync(filePath).mode;
    return (mode & 0o077) !== 0;
  } catch {
    return false;
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}
