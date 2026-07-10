import { confirm, input, password, select } from '@inquirer/prompts';
import type { Logger } from '../logging/logger.js';
import {
  isWorldReadable,
  loadUserConfig,
  maskSecrets,
  saveUserConfig,
  userConfigPath,
  type UserConfig,
} from '../config/user-config.js';

export interface Prompter {
  confirm: typeof confirm;
  input: typeof input;
  password: typeof password;
  select: typeof select;
}

const DEFAULT_PROMPTER: Prompter = { confirm, input, password, select };

export interface InitUserOptions {
  logger: Logger;
  configPath?: string;
  prompter?: Prompter;
}

const WIKI_BACKEND_CHOICES = [
  { name: 'Azure DevOps Wiki', value: 'azure-devops-wiki' as const },
  // Additional backends land here as new choices — the prompt shape itself never changes
  // (spec `user-config`: "Wiki backend selection is extensible").
];

const LLM_PROVIDER_CHOICES = [{ name: 'OpenRouter', value: 'openrouter' as const }];

async function requireNonEmpty(prompt: () => Promise<string>, fieldLabel: string): Promise<string> {
  for (;;) {
    const value = (await prompt()).trim();
    if (value.length > 0) return value;
    process.stderr.write(`${fieldLabel} is required.\n`);
  }
}

async function collectWikiBackend(prompter: Prompter): Promise<UserConfig['wikiBackend']> {
  await prompter.select({
    message:
      'Select your wiki backend (more backends are planned; Azure DevOps Wiki is the only option in MVP):',
    choices: WIKI_BACKEND_CHOICES,
  });
  const organization = await requireNonEmpty(
    () => prompter.input({ message: 'Azure DevOps organization:' }),
    'Organization',
  );
  const project = await requireNonEmpty(
    () => prompter.input({ message: 'Azure DevOps project:' }),
    'Project',
  );
  const wikiIdentifier = await requireNonEmpty(
    () => prompter.input({ message: 'Wiki identifier:' }),
    'Wiki identifier',
  );
  const personalAccessToken = await requireNonEmpty(
    () => prompter.password({ message: 'Azure DevOps Personal Access Token:' }),
    'Personal Access Token',
  );
  return { type: 'azure-devops-wiki', organization, project, wikiIdentifier, personalAccessToken };
}

const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

async function collectLlmProvider(prompter: Prompter): Promise<UserConfig['llmProvider']> {
  await prompter.select({
    message: 'Select your LLM provider (OpenRouter is the only option in MVP):',
    choices: LLM_PROVIDER_CHOICES,
  });
  const apiKey = await requireNonEmpty(
    () => prompter.password({ message: 'OpenRouter API key:' }),
    'API key',
  );
  const modelRaw = await prompter.input({
    message: 'OpenRouter model (leave blank to use default):',
    default: DEFAULT_MODEL,
  });
  const model = modelRaw?.trim() || null;
  return { type: 'openrouter', apiKey, model };
}

function warnIfWorldReadable(logger: Logger, filePath: string): void {
  if (isWorldReadable(filePath)) {
    logger.warn(
      `${filePath} is readable by other users on this machine. Run \`chmod 600 ${filePath}\` to restrict it.`,
    );
  }
}

async function freshInstall(prompter: Prompter, filePath: string, logger: Logger): Promise<void> {
  logger.info('No existing Docwelder user configuration found. Setting one up now.');
  const wikiBackend = await collectWikiBackend(prompter);
  const llmProvider = await collectLlmProvider(prompter);
  saveUserConfig({ wikiBackend, llmProvider }, filePath);
  logger.info(`Saved user configuration to ${filePath}.`);
  warnIfWorldReadable(logger, filePath);
}

/** Re-prompts one field at a time, requiring explicit confirmation before overwriting (spec `user-config`). */
async function rerun(
  prompter: Prompter,
  filePath: string,
  logger: Logger,
  existing: UserConfig,
): Promise<void> {
  const masked = maskSecrets(existing) as {
    wikiBackend: Record<string, unknown>;
    llmProvider: Record<string, unknown>;
  };
  logger.info(`Existing configuration at ${filePath} (secrets masked):`);
  logger.info(JSON.stringify(masked, null, 2));
  warnIfWorldReadable(logger, filePath);

  let wikiBackend = existing.wikiBackend;
  if (
    await prompter.confirm({
      message: `Update wiki backend settings? (current organization: ${existing.wikiBackend.organization})`,
      default: false,
    })
  ) {
    wikiBackend = await collectWikiBackend(prompter);
  }

  let llmProvider = existing.llmProvider;
  if (
    await prompter.confirm({
      message: 'Update LLM provider settings? (current provider: openrouter)',
      default: false,
    })
  ) {
    llmProvider = await collectLlmProvider(prompter);
  }

  saveUserConfig({ wikiBackend, llmProvider }, filePath);
  logger.info(`Saved user configuration to ${filePath}.`);
  warnIfWorldReadable(logger, filePath);
}

/**
 * Persists per-machine credentials to `~/.config/docwelder/config.yaml`. This
 * command — and `init`/`upgrade`, which may read the same file — are the ONLY
 * commands that ever call `loadUserConfig`/`userConfigPath`. `propose` and
 * `publish` run inside CI and read credentials solely from CI variables via
 * `EnvCredentialSource`; neither imports anything from `config/user-config.ts`
 * (spec `user-config`: "CI commands ignore user config").
 */
export async function runInitUser(options: InitUserOptions): Promise<number> {
  const { logger } = options;
  const filePath = options.configPath ?? userConfigPath();
  const prompter = options.prompter ?? DEFAULT_PROMPTER;

  const existing = loadUserConfig(filePath);
  if (existing) {
    await rerun(prompter, filePath, logger, existing);
  } else {
    await freshInstall(prompter, filePath, logger);
  }
  return 0;
}
