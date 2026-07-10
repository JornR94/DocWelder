import { readFileSync } from 'node:fs';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';
import { ConfigValidationError, zodIssuesToConfigDetails } from './errors.js';

/**
 * Structural rules are enforced by a deterministic validator (spec
 * `doc-style-config`, "Structural rules are enforced post-generation") —
 * their pass/fail outcome never depends on the LLM.
 */
export const StructuralRulesSchema = z
  .object({
    required_readme_sections: z.array(z.string()).default(['Installation', 'Usage']),
    max_word_count_per_section: z.number().int().positive().default(400),
    heading_depth_limit: z.number().int().positive().default(4),
    /** Empty = unrestricted. `docwelder init` populates this from detected repo languages. */
    code_block_language_whitelist: z.array(z.string()).default([]),
    changelog_format: z.literal('keep-a-changelog').default('keep-a-changelog'),
  })
  .strict();

const AUDIENCE_VALUES = ['mixed', 'technical', 'non-technical'] as const;
const CONCISENESS_VALUES = ['terse', 'balanced', 'thorough'] as const;
const CODE_EXAMPLE_POLICY_VALUES = ['mixed-audience', 'always', 'never'] as const;
const DIAGRAM_POLICY_VALUES = ['mermaid-for-architecture-changes', 'always', 'never'] as const;
const README_WIKI_POLICY_VALUES = ['link-to-wiki', 'duplicate', 'wiki-only'] as const;
const UPDATE_TRIGGER_VALUES = [
  'public-api',
  'config-env',
  'breaking-changes',
  'dependencies',
] as const;

/**
 * Soft style guidance injected into the LLM prompt (spec `doc-style-config`).
 * Defaults match `docwelder init`'s default-mode opinionated profile exactly
 * (spec: "Style guidance defaults from default mode answers"). Only
 * `audience`, `conciseness`, `update_triggers`, `readme_wiki_policy`, and
 * `exclusions` are ever asked about in advanced mode (spec `repo-init`:
 * "at most five questions") — `tone`, `code_example_policy`, and
 * `diagram_policy` are always defaulted, in both setup modes.
 */
export const StyleGuidanceSchema = z
  .object({
    tone: z.string().default('mixed-audience'),
    audience: z.enum(AUDIENCE_VALUES).default('mixed'),
    conciseness: z.enum(CONCISENESS_VALUES).default('balanced'),
    code_example_policy: z.enum(CODE_EXAMPLE_POLICY_VALUES).default('mixed-audience'),
    diagram_policy: z.enum(DIAGRAM_POLICY_VALUES).default('mermaid-for-architecture-changes'),
    readme_wiki_policy: z.enum(README_WIKI_POLICY_VALUES).default('link-to-wiki'),
    update_triggers: z.array(z.enum(UPDATE_TRIGGER_VALUES)).default(['public-api', 'config-env']),
    exclusions: z.array(z.string()).default([]),
  })
  .strict();

/** Non-secret wiki connection routing. The PAT itself always comes from a CI variable, never this file. */
export const WikiBackendConfigSchema = z
  .object({
    type: z.literal('azure-devops-wiki').default('azure-devops-wiki'),
    organization: z.string().min(1),
    project: z.string().min(1),
    wiki_identifier: z.string().min(1),
  })
  .strict();

/**
 * `llm.model` overrides the container image's default OpenRouter model
 * (spec `doc-style-config`: "LLM model override field"). `retry_limit` and
 * `token_budget` resolve design Open Question #1 (task 16.1).
 */
export const LlmConfigSchema = z
  .object({
    model: z.string().min(1).nullable().default('deepseek/deepseek-v4-flash'),
    retry_limit: z.number().int().min(0).default(3),
    token_budget: z.number().int().positive().default(200_000),
  })
  .strict();

export const DocStyleConfigSchema = z
  .object({
    structural_rules: StructuralRulesSchema.default({}),
    style_guidance: StyleGuidanceSchema.default({}),
    wiki_backend: WikiBackendConfigSchema,
    llm: LlmConfigSchema.default({}),
  })
  .strict();

export type DocStyleConfig = z.infer<typeof DocStyleConfigSchema>;

const CONFIG_RELATIVE_PATH = '.docs/config.yaml';

/** Parses and validates `.docs/config.yaml`, failing fast per spec `doc-style-config`. */
export function parseDocStyleConfig(
  raw: string,
  filePath: string = CONFIG_RELATIVE_PATH,
): DocStyleConfig {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    if (err instanceof YAMLParseError) {
      throw new ConfigValidationError(filePath, [
        {
          line: err.linePos?.[0]?.line,
          message: err.message,
        },
      ]);
    }
    throw new ConfigValidationError(filePath, [{ message: String(err) }]);
  }

  const result = DocStyleConfigSchema.safeParse(parsed ?? {});
  if (!result.success) {
    throw new ConfigValidationError(filePath, zodIssuesToConfigDetails(result.error.issues));
  }
  return result.data;
}

export function loadDocStyleConfig(filePath: string = CONFIG_RELATIVE_PATH): DocStyleConfig {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new ConfigValidationError(filePath, [
      { message: `Unable to read file: ${err instanceof Error ? err.message : String(err)}` },
    ]);
  }
  return parseDocStyleConfig(raw, filePath);
}
