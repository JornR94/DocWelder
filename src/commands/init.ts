import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Logger } from '../logging/logger.js';
import { loadUserConfig, type UserConfig } from '../config/user-config.js';
import { DocStyleConfigSchema, type DocStyleConfig } from '../config/doc-style-config.js';
import type { MappingFile } from '../config/mapping.js';
import { MapCredentialSource } from '../adapters/registry.js';
import { wikiBackendRegistry } from '../adapters/wiki-backend/registry.js';
import type { WikiBackend } from '../adapters/wiki-backend/interface.js';
import { llmProviderRegistry } from '../adapters/llm-provider/registry.js';
import type { LLMProvider } from '../adapters/llm-provider/interface.js';
import { validateReadme } from '../validators/structural.js';
import { generateChangelogFromHistory } from '../pipeline/changelog-history.js';
import {
  analyzeRepo,
  detectPrimaryLanguages,
  generateReadme,
} from '../pipeline/readme-generation.js';
import { editMappingInEditor, proposeMapping } from '../pipeline/mapping-proposal.js';
import { DOCWELDER_VERSION } from '../version.js';

export interface Prompter {
  confirm: typeof confirm;
  input: typeof input;
  select: typeof select;
  checkbox: typeof checkbox;
}

const DEFAULT_PROMPTER: Prompter = { confirm, input, select, checkbox };

export interface InitOptions {
  logger: Logger;
  cwd?: string;
  prompter?: Prompter;
  /** Test-only override; when omitted, real `loadUserConfig()` is used. */
  userConfig?: UserConfig | null;
  /** Test-only fake adapters, bypassing the registries/network entirely. */
  wikiBackend?: WikiBackend;
  llmProvider?: LLMProvider;
  editorSpawn?: typeof spawnSync;
}

const CI_INCLUDE_URL = `https://raw.githubusercontent.com/JornR94/DocWelder/v${DOCWELDER_VERSION}/release/ci-template.yml`;

function isGitRepo(cwd: string): boolean {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function runInit(options: InitOptions): Promise<number> {
  const { logger } = options;
  const cwd = options.cwd ?? process.cwd();
  const prompter = options.prompter ?? DEFAULT_PROMPTER;

  if (!isGitRepo(cwd)) {
    logger.error('docwelder init must be run inside a git repository.');
    return 1;
  }

  const userConfig = options.userConfig !== undefined ? options.userConfig : loadUserConfig();
  if (!userConfig) {
    logger.error('No user configuration found. Run `docwelder init-user` first.');
    return 1;
  }

  const docsDir = join(cwd, '.docs');
  const configPath = join(docsDir, 'config.yaml');
  const mappingPath = join(docsDir, 'mapping.yaml');
  const gitignorePath = join(docsDir, '.gitignore');
  const ciFilePath = join(cwd, '.gitlab-ci.yml');
  const readmePath = join(cwd, 'README.md');
  const changelogPath = join(cwd, 'CHANGELOG.md');

  if (existsSync(configPath)) {
    const proceed = await prompter.confirm({
      message:
        'This repository is already onboarded to Docwelder (.docs/config.yaml exists). Re-run onboarding and potentially modify existing artifacts?',
      default: false,
    });
    if (!proceed) {
      logger.info('Aborted: repository is already onboarded to Docwelder.');
      return 0;
    }
  }

  const mode = await prompter.select({
    message: 'How would you like to configure Docwelder for this repository?',
    choices: [
      { name: 'Default (recommended opinionated setup)', value: 'default' as const },
      { name: 'Advanced (answer a few questions)', value: 'advanced' as const },
    ],
  });

  const repoSummary = analyzeRepo(cwd);
  const primaryLanguages = detectPrimaryLanguages(repoSummary.languageCounts);

  let styleGuidance: Partial<DocStyleConfig['style_guidance']> = {};
  if (mode === 'advanced') {
    const audience = await prompter.select({
      message: 'Audience?',
      choices: [
        { name: 'Mixed', value: 'mixed' as const },
        { name: 'Technical', value: 'technical' as const },
        { name: 'Non-technical', value: 'non-technical' as const },
      ],
    });
    const conciseness = await prompter.select({
      message: 'Depth / conciseness?',
      choices: [
        { name: 'Terse', value: 'terse' as const },
        { name: 'Balanced', value: 'balanced' as const },
        { name: 'Thorough', value: 'thorough' as const },
      ],
    });
    const updateTriggers = await prompter.checkbox({
      message: 'Which changes should trigger doc updates?',
      choices: [
        { name: 'Public API changes', value: 'public-api' as const, checked: true },
        { name: 'Config/env changes', value: 'config-env' as const, checked: true },
        { name: 'Breaking changes', value: 'breaking-changes' as const },
        { name: 'Dependency changes', value: 'dependencies' as const },
      ],
    });
    const readmeWikiPolicy = await prompter.select({
      message: 'README <-> wiki overlap policy?',
      choices: [
        { name: 'Link to wiki from README', value: 'link-to-wiki' as const },
        { name: 'Duplicate content in both', value: 'duplicate' as const },
        { name: 'Wiki only (no overlap in README)', value: 'wiki-only' as const },
      ],
    });
    const exclusionsRaw = await prompter.input({
      message: 'Exclusion globs (comma-separated, blank for none)?',
      default: '',
    });
    styleGuidance = {
      audience,
      conciseness,
      update_triggers: updateTriggers,
      readme_wiki_policy: readmeWikiPolicy,
      exclusions: exclusionsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  const config = DocStyleConfigSchema.parse({
    structural_rules: {
      code_block_language_whitelist: primaryLanguages,
    },
    style_guidance: styleGuidance,
    wiki_backend: {
      organization: userConfig.wikiBackend.organization,
      project: userConfig.wikiBackend.project,
      wiki_identifier: userConfig.wikiBackend.wikiIdentifier,
    },
  });

  // README detection / verification / generation (task 9.4, 9.5).
  if (existsSync(readmePath)) {
    const existing = readFileSync(readmePath, 'utf8');
    const findings = validateReadme(existing, config.structural_rules, cwd);
    if (findings.length > 0) {
      logger.warn('Existing README.md has potential issues (left unchanged):');
      for (const finding of findings) logger.warn(`  - ${finding}`);
    } else {
      logger.info('Existing README.md looks consistent with the codebase; left unchanged.');
    }
  } else {
    const llmProvider =
      options.llmProvider ??
      llmProviderRegistry.create(
        'openrouter',
        new MapCredentialSource({ OPENROUTER_API_KEY: userConfig.llmProvider.apiKey }),
        undefined,
      );
    const generated = await generateReadme(llmProvider, repoSummary, config, cwd);
    if (generated.errors.length > 0) {
      logger.warn(
        `Generated README did not pass all structural checks after retries; writing best-effort draft. Remaining issues: ${generated.errors.join('; ')}`,
      );
    }
    writeFileSync(readmePath, generated.content || `# ${repoSummary.name}\n`);
    logger.info('Generated README.md from codebase analysis.');
  }

  // CHANGELOG detection / generation (task 9.6).
  if (existsSync(changelogPath)) {
    logger.info('Existing CHANGELOG.md found; left unchanged.');
  } else {
    writeFileSync(changelogPath, generateChangelogFromHistory(cwd));
    logger.info('Generated CHANGELOG.md from git history.');
  }

  // Wiki scan (task 9.7).
  const wikiBackend =
    options.wikiBackend ??
    wikiBackendRegistry.create(
      'azure-devops-wiki',
      new MapCredentialSource({ ADO_WIKI_PAT: userConfig.wikiBackend.personalAccessToken }),
      {
        organization: userConfig.wikiBackend.organization,
        project: userConfig.wikiBackend.project,
        wikiIdentifier: userConfig.wikiBackend.wikiIdentifier,
      },
    );
  const wikiCandidates = await wikiBackend.listPages({
    repoName: repoSummary.name,
    pathSegments: repoSummary.topLevelEntries,
    keywords: primaryLanguages,
  });
  logger.info(
    wikiCandidates.length > 0
      ? `Wiki scan found ${wikiCandidates.length} candidate page(s): ${wikiCandidates
          .map((c) => `${c.path} (score ${c.matchScore.toFixed(2)})`)
          .join(', ')}`
      : 'Wiki scan found no obviously related pages.',
  );

  // AI-proposed mapping (task 9.8).
  let mapping: MappingFile = { mappings: [] };
  const llmProviderForMapping =
    options.llmProvider ??
    llmProviderRegistry.create(
      'openrouter',
      new MapCredentialSource({ OPENROUTER_API_KEY: userConfig.llmProvider.apiKey }),
      undefined,
    );
  const proposedMapping = await proposeMapping(
    llmProviderForMapping,
    repoSummary.topLevelEntries,
    wikiCandidates,
  );
  const mappingChoice = await prompter.select({
    message: `Docwelder proposes ${proposedMapping.mappings.length} code-path -> wiki-page mapping(s). What would you like to do?`,
    choices: [
      { name: 'Accept as-is', value: 'accept' as const },
      { name: 'Edit in $EDITOR', value: 'edit' as const },
      { name: 'Reject (start with an empty mapping)', value: 'reject' as const },
    ],
  });
  if (mappingChoice === 'accept') {
    mapping = proposedMapping;
  } else if (mappingChoice === 'edit') {
    mapping = editMappingInEditor(proposedMapping, options.editorSpawn ?? spawnSync);
  } else {
    mapping = { mappings: [] };
  }

  // Artifact writes (task 9.9).
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(configPath, stringifyYaml(config));
  writeFileSync(mappingPath, stringifyYaml(mapping));
  // Deliberately does NOT ignore wiki-staging/ (design D5): those files must
  // appear in the MR diff for human review. This overrides the repo-init
  // spec's literal artifact-list parenthetical ("ignoring .docs/wiki-staging/"),
  // which conflicts with D5's explicit reasoning — D5 wins since untracked
  // staging files would silently be skipped by `git add -A` in commitAndPush,
  // breaking the review mechanism the whole pipeline depends on.
  writeFileSync(
    gitignorePath,
    '# Intentionally empty: wiki-staging/ must stay tracked so it appears in MR diffs (design D5).\n',
  );

  // .gitlab-ci.yml write/append (task 9.9, 9.10).
  if (!existsSync(ciFilePath)) {
    writeFileSync(ciFilePath, `include:\n  - remote: ${CI_INCLUDE_URL}\n`);
  } else {
    const raw = readFileSync(ciFilePath, 'utf8');
    const parsed = (parseYaml(raw) ?? {}) as Record<string, unknown>;
    const existingInclude = parsed.include;
    let includeList: unknown[];
    if (Array.isArray(existingInclude)) {
      includeList = existingInclude;
    } else if (existingInclude !== undefined) {
      includeList = [existingInclude];
    } else {
      includeList = [];
    }
    const alreadyPresent = includeList.some(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as Record<string, unknown>).remote === CI_INCLUDE_URL,
    );
    if (!alreadyPresent) {
      includeList.push({ remote: CI_INCLUDE_URL });
      parsed.include = includeList;
      writeFileSync(ciFilePath, stringifyYaml(parsed));
    }
  }

  // Post-init instructions (task 9.11) — resolves design Open Question #3: per-repo bot naming.
  const botName = `docwelder-bot-${slugify(basename(cwd) || repoSummary.name)}`;
  logger.info('Docwelder onboarding complete. Before merging, please:');
  logger.info(
    `  1. Create a GitLab bot user "${botName}" with Developer/Maintainer role and a project access token scoped to "api" + "write_repository".`,
  );
  logger.info(
    '  2. Add CI/CD variables (masked, protected): ADO_WIKI_PAT, GITLAB_BOT_TOKEN, OPENROUTER_API_KEY.',
  );
  logger.info(
    `  3. Confirm "${botName}" has Contribute permission on the "${userConfig.wikiBackend.wikiIdentifier}" wiki in ADO project "${userConfig.wikiBackend.project}".`,
  );

  return 0;
}
