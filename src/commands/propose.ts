import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GitHost } from '../adapters/git-host/interface.js';
import { gitHostRegistry } from '../adapters/git-host/registry.js';
import type { WikiBackend } from '../adapters/wiki-backend/interface.js';
import { WikiNotFoundError } from '../adapters/wiki-backend/interface.js';
import { wikiBackendRegistry } from '../adapters/wiki-backend/registry.js';
import type { LLMProvider, ChatMessage } from '../adapters/llm-provider/interface.js';
import { llmProviderRegistry } from '../adapters/llm-provider/registry.js';
import {
  proposalJsonSchema,
  ProposalSchema,
  type Proposal,
} from '../adapters/llm-provider/propose-contract.js';
import { appendValidationRetry } from '../adapters/llm-provider/retry.js';
import { TokenBudgetTracker } from '../adapters/llm-provider/budget.js';
import { EnvCredentialSource } from '../adapters/registry.js';
import { ConfigValidationError } from '../config/errors.js';
import { loadDocStyleConfig, type DocStyleConfig } from '../config/doc-style-config.js';
import { loadMapping, type MappingFile } from '../config/mapping.js';
import {
  MANIFEST_PATH,
  WIKI_STAGING_DIR,
  parseManifest,
  serializeManifest,
  type Manifest,
  type ManifestEntry,
} from '../pipeline/manifest.js';
import {
  defaultState,
  parseState,
  serializeState,
  sha256,
  STATE_PATH,
  type DocwelderState,
} from '../pipeline/state.js';
import {
  validateChangelogEntry,
  validateReadme,
  validateWikiPage,
} from '../validators/structural.js';
import { appendChangelogEntry } from '../pipeline/changelog-entry.js';
import { shouldShortCircuit } from '../pipeline/recursion-guard.js';
import type { Logger } from '../logging/logger.js';

export interface ProposeOptions {
  logger: Logger;
  cwd?: string;
}

export const BOT_AUTHOR_NAME = 'Docwelder Bot';

const DOC_ONLY_FILE_PATTERN =
  /(^|\/)(README\.md|CHANGELOG\.md|docs\/.*|.*\.md|.*\.test\.[jt]sx?|.*\.spec\.[jt]sx?|__tests__\/.*|test\/.*|tests\/.*)$/i;

export interface ProposeCoreDeps {
  gitHost: GitHost;
  createWikiBackend: () => WikiBackend;
  createLlmProvider: () => LLMProvider;
  config: DocStyleConfig;
  mapping: MappingFile;
  cwd: string;
  logger: Logger;
  env: Record<string, string | undefined>;
  botAuthorName?: string;
}

function extractChangedFilePaths(diffRaw: string): string[] {
  const paths = new Set<string>();
  const regex = /^diff --git a\/(.+?) b\/(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(diffRaw)) !== null) {
    paths.add(match[2]!);
  }
  return [...paths];
}

/**
 * Best-effort no-op detector (task 10.16). A diff is treated as "nothing to
 * propose about" when it's empty, or when every changed file looks like a
 * doc/test/CI artifact rather than source that could affect the public API
 * or config/env surface. Deliberately coarse — see tasks.md for rationale.
 */
export function isNoOpDiff(diffRaw: string): boolean {
  if (diffRaw.trim().length === 0) return true;
  const files = extractChangedFilePaths(diffRaw);
  if (files.length === 0) return true;
  return files.every((f) => DOC_ONLY_FILE_PATTERN.test(f));
}

function slugifyWikiPath(wikiPath: string): string {
  const slug = wikiPath
    .replace(/^\/+/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  return `pages/${slug.length > 0 ? slug : 'page'}.md`;
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function buildSystemPrompt(config: DocStyleConfig): string {
  const { structural_rules: rules, style_guidance: style } = config;
  return [
    "You are Docwelder, a documentation-generation assistant. Given a code diff and the repository's " +
      'current README, CHANGELOG, and wiki pages, propose documentation updates that keep docs in sync ' +
      'with the code. The codebase is the source of truth — never propose code changes, only documentation.',
    `Structural rules: required README sections: ${rules.required_readme_sections.join(', ')}; ` +
      `max words per section: ${rules.max_word_count_per_section}; max heading depth: ${rules.heading_depth_limit}; ` +
      `code block languages allowed: ${rules.code_block_language_whitelist.join(', ') || '(any)'}; ` +
      `changelog format: ${rules.changelog_format}.`,
    `Style guidance: tone=${style.tone}; audience=${style.audience}; conciseness=${style.conciseness}; ` +
      `code_example_policy=${style.code_example_policy}; diagram_policy=${style.diagram_policy}; ` +
      `readme_wiki_policy=${style.readme_wiki_policy}; exclusions=${style.exclusions.join(', ') || '(none)'}.`,
    'Respond only with structured output matching the provided schema. Set readme/changelog to null and ' +
      'wikiPages to [] for any artifact that genuinely needs no change.',
  ].join('\n\n');
}

function buildUserPrompt(
  diffRaw: string,
  currentReadme: string,
  currentChangelog: string,
  wikiSnapshot: { path: string; content: string }[],
): string {
  const sections = [
    `--- Diff under review ---\n${diffRaw}`,
    `--- Current README.md ---\n${currentReadme || '(no README.md yet)'}`,
    `--- Current CHANGELOG.md ---\n${currentChangelog || '(no CHANGELOG.md yet)'}`,
  ];
  if (wikiSnapshot.length > 0) {
    sections.push(
      `--- Wiki pages ---\n` +
        wikiSnapshot
          .map((p) => `## ${p.path}\n${p.content || '(page does not exist yet)'}`)
          .join('\n\n'),
    );
  }
  return sections.join('\n\n');
}

/** Core proposal logic with all I/O boundaries injected, for testability. */
export async function proposeCore(deps: ProposeCoreDeps): Promise<number> {
  const { gitHost, config, mapping, cwd, logger, env } = deps;
  const botAuthorName = deps.botAuthorName ?? BOT_AUTHOR_NAME;

  const baseRef = env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
  if (!baseRef) {
    logger.error(
      'CI_MERGE_REQUEST_DIFF_BASE_SHA is not set; cannot compute the merge request diff.',
    );
    return 1;
  }
  const mrIidRaw = env.CI_MERGE_REQUEST_IID;
  const mrIid = mrIidRaw ? Number(mrIidRaw) : NaN;
  if (!mrIidRaw || Number.isNaN(mrIid)) {
    logger.error(
      'CI_MERGE_REQUEST_IID is not set or not numeric; cannot post comments on the merge request.',
    );
    return 1;
  }

  let diff: Awaited<ReturnType<GitHost['diff']>>;
  try {
    diff = await gitHost.diff(baseRef, 'HEAD');
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  try {
    if (await shouldShortCircuit(gitHost, baseRef, botAuthorName)) {
      logger.info(
        'Recursion guard: HEAD contains only bot commits since the diff base; nothing to do.',
      );
      await gitHost.commentOnMergeRequest(
        mrIid,
        'Docwelder: no new changes since the last bot regeneration.',
      );
      return 0;
    }
  } catch (err) {
    logger.warn(
      `Recursion guard check failed, proceeding anyway: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (isNoOpDiff(diff.raw)) {
    logger.info('Diff does not touch anything doc-relevant; posting no-op comment.');
    await gitHost.commentOnMergeRequest(
      mrIid,
      'Docwelder: no documentation changes are required for this change.',
    );
    return 0;
  }

  const statePath = join(cwd, STATE_PATH);
  const state: DocwelderState = existsSync(statePath)
    ? parseState(readFileSync(statePath, 'utf8'))
    : defaultState();

  const manifestPath = join(cwd, MANIFEST_PATH);
  const oldManifest: Manifest = existsSync(manifestPath)
    ? parseManifest(readFileSync(manifestPath, 'utf8'))
    : { entries: [] };

  const readmePath = join(cwd, 'README.md');
  const changelogPath = join(cwd, 'CHANGELOG.md');
  const currentReadme = readIfExists(readmePath);
  const currentChangelog = readIfExists(changelogPath);

  const readmeEligible =
    state.artifacts.readme === null || sha256(currentReadme) === state.artifacts.readme;
  const changelogEligible =
    state.artifacts.changelogEntry === null ||
    currentChangelog.includes(state.artifacts.changelogEntry);

  function isWikiPageEligible(wikiPath: string): boolean {
    const recordedSha = state.artifacts.wikiPages[wikiPath];
    if (recordedSha === undefined) return true;
    const oldEntry = oldManifest.entries.find((e) => e.wiki_path === wikiPath);
    if (!oldEntry) return true;
    const fullPath = join(cwd, WIKI_STAGING_DIR, oldEntry.local_file);
    if (!existsSync(fullPath)) return true;
    return sha256(readFileSync(fullPath, 'utf8')) === recordedSha;
  }

  const keptHumanEdits: string[] = [];
  if (!readmeEligible) keptHumanEdits.push('README.md');
  if (!changelogEligible) keptHumanEdits.push('CHANGELOG.md (last bot entry)');

  const uniqueWikiPaths = [...new Set(mapping.mappings.map((m) => m.wiki_path))];
  const wikiBackend = uniqueWikiPaths.length > 0 ? deps.createWikiBackend() : null;
  const wikiSnapshot: { path: string; content: string; etag?: string }[] = [];
  for (const path of uniqueWikiPaths) {
    try {
      const page = await wikiBackend!.getPage(path);
      wikiSnapshot.push({ path, content: page.content, etag: page.etag });
    } catch (err) {
      if (err instanceof WikiNotFoundError) {
        wikiSnapshot.push({ path, content: '' });
      } else {
        throw err;
      }
    }
  }

  const llmProvider = deps.createLlmProvider();
  let messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(config) },
    {
      role: 'user',
      content: buildUserPrompt(diff.raw, currentReadme, currentChangelog, wikiSnapshot),
    },
  ];

  const tracker = new TokenBudgetTracker(config.llm.token_budget);
  let proposal: Proposal | null = null;
  let finalErrors: string[] = [];
  let budgetExhausted = false;

  for (let attempt = 0; attempt <= config.llm.retry_limit; attempt++) {
    const result = await llmProvider.completeStructured({
      messages,
      responseSchema: proposalJsonSchema(),
      schemaName: 'docwelder_proposal',
      model: config.llm.model ?? undefined,
    });
    tracker.record(result.usage);
    const candidate = ProposalSchema.parse(result.data);

    const errors: string[] = [];
    if (candidate.readme && readmeEligible) {
      errors.push(...validateReadme(candidate.readme.content, config.structural_rules, cwd));
    }
    if (candidate.changelog && changelogEligible) {
      errors.push(...validateChangelogEntry(candidate.changelog, config.structural_rules));
    }
    for (const page of candidate.wikiPages) {
      if (isWikiPageEligible(page.path)) {
        errors.push(
          ...validateWikiPage(page.content, config.structural_rules).map(
            (e) => `[${page.path}] ${e}`,
          ),
        );
      }
    }

    if (errors.length === 0) {
      proposal = candidate;
      break;
    }

    finalErrors = errors;
    proposal = candidate;

    if (tracker.exceeded()) {
      budgetExhausted = true;
      break;
    }
    if (attempt >= config.llm.retry_limit) {
      break;
    }
    messages = appendValidationRetry(messages, candidate, errors);
  }

  if (finalErrors.length > 0 || budgetExhausted) {
    const reason = budgetExhausted
      ? 'the per-MR token budget was exhausted before a valid proposal was produced'
      : 'structural validation failed after exhausting the retry limit';
    const body = [
      `Docwelder: could not produce a valid documentation proposal (${reason}).`,
      finalErrors.length > 0
        ? `Validation errors:\n${finalErrors.map((e) => `- ${e}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    logger.warn(`Propose failing non-blockingly: ${reason}`);
    await gitHost.commentOnMergeRequest(mrIid, body);
    return 0;
  }

  if (!proposal) {
    logger.info('LLM produced no proposal content.');
    return 0;
  }

  if (!proposal.readme && !proposal.changelog && proposal.wikiPages.length === 0) {
    await gitHost.commentOnMergeRequest(
      mrIid,
      'Docwelder: no documentation changes are required for this change.',
    );
    return 0;
  }

  const changes: { path: string; content: string | null }[] = [];
  const newState: DocwelderState = {
    artifacts: {
      readme: state.artifacts.readme,
      changelogEntry: state.artifacts.changelogEntry,
      wikiPages: { ...state.artifacts.wikiPages },
    },
  };
  const summaryLines: string[] = [];

  if (proposal.readme && readmeEligible) {
    changes.push({ path: readmePath, content: proposal.readme.content });
    newState.artifacts.readme = sha256(proposal.readme.content);
    summaryLines.push('- README.md updated');
  }

  if (proposal.changelog && changelogEligible) {
    const updatedChangelog = appendChangelogEntry(currentChangelog, proposal.changelog);
    changes.push({ path: changelogPath, content: updatedChangelog });
    newState.artifacts.changelogEntry = `- ${proposal.changelog.description}`;
    summaryLines.push(
      `- CHANGELOG entry added (${proposal.changelog.category}): ${proposal.changelog.description}`,
    );
  }

  const manifestEntries: ManifestEntry[] = oldManifest.entries.filter(
    (e) => !uniqueWikiPaths.includes(e.wiki_path) || !isWikiPageEligible(e.wiki_path),
  );
  for (const page of proposal.wikiPages) {
    if (!isWikiPageEligible(page.path)) {
      keptHumanEdits.push(`wiki page ${page.path}`);
      continue;
    }
    const localFile = slugifyWikiPath(page.path);
    const snapshot = wikiSnapshot.find((s) => s.path === page.path);
    const operation: 'update' | 'create' = snapshot && snapshot.etag ? 'update' : 'create';
    changes.push({ path: join(cwd, WIKI_STAGING_DIR, localFile), content: page.content });
    manifestEntries.push({
      wiki_path: page.path,
      operation,
      local_file: localFile,
      ...(operation === 'update' ? { source_etag: snapshot!.etag } : {}),
    });
    newState.artifacts.wikiPages[page.path] = sha256(page.content);
    summaryLines.push(`- Wiki page ${page.path} (${operation})`);
  }

  if (changes.length === 0) {
    const body = [
      'Docwelder: no new bot changes this run.',
      keptHumanEdits.length > 0
        ? `Kept human edits:\n${keptHumanEdits.map((e) => `- ${e}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    await gitHost.commentOnMergeRequest(mrIid, body);
    return 0;
  }

  changes.push({ path: manifestPath, content: serializeManifest({ entries: manifestEntries }) });
  changes.push({ path: statePath, content: serializeState(newState) });

  const commitResult = await gitHost.commitAndPush({
    branch: env.CI_MERGE_REQUEST_SOURCE_BRANCH ?? '',
    message: 'docwelder: update generated documentation',
    changes,
  });

  const summaryBody = [
    'Docwelder proposal summary:',
    summaryLines.join('\n'),
    keptHumanEdits.length > 0
      ? `\nKept human edits:\n${keptHumanEdits.map((e) => `- ${e}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  if (commitResult.skipped) {
    logger.info('Nothing to commit (all eligible outputs matched existing content).');
  }
  await gitHost.commentOnMergeRequest(mrIid, summaryBody);
  return 0;
}

export async function runPropose(options: ProposeOptions): Promise<number> {
  const { logger } = options;
  const cwd = options.cwd ?? process.cwd();
  const env = process.env;

  if (env.CI_PIPELINE_SOURCE !== 'merge_request_event') {
    logger.error(
      'docwelder propose is designed to run inside a merge_request_event pipeline (CI_PIPELINE_SOURCE mismatch).',
    );
    return 1;
  }

  let config: DocStyleConfig;
  let mapping: MappingFile;
  try {
    config = loadDocStyleConfig(join(cwd, '.docs/config.yaml'));
    mapping = loadMapping(join(cwd, '.docs/mapping.yaml'));
  } catch (err) {
    const detail = err instanceof ConfigValidationError ? err.message : String(err);
    logger.error(`${detail}\nRun \`docwelder init\` first to onboard this repository.`);
    return 1;
  }

  let gitHost: GitHost;
  try {
    gitHost = gitHostRegistry.create('gitlab', new EnvCredentialSource(), {
      serverHost: env.CI_SERVER_HOST ?? '',
      projectId: env.CI_PROJECT_ID ?? '',
      projectPath: env.CI_PROJECT_PATH ?? '',
      apiBaseUrl: env.CI_API_V4_URL,
      mergeRequestIid: env.CI_MERGE_REQUEST_IID,
    });
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  try {
    return await proposeCore({
      gitHost,
      createWikiBackend: () =>
        wikiBackendRegistry.create('azure-devops-wiki', new EnvCredentialSource(), {
          organization: config.wiki_backend.organization,
          project: config.wiki_backend.project,
          wikiIdentifier: config.wiki_backend.wiki_identifier,
        }),
      createLlmProvider: () =>
        llmProviderRegistry.create('openrouter', new EnvCredentialSource(), undefined),
      config,
      mapping,
      cwd,
      logger,
      env,
    });
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
