import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOT_AUTHOR_NAME,
  isNoOpDiff,
  proposeCore,
  type ProposeCoreDeps,
} from '../../../src/commands/propose.js';
import { parseDocStyleConfig, type DocStyleConfig } from '../../../src/config/doc-style-config.js';
import { parseMapping, type MappingFile } from '../../../src/config/mapping.js';
import { MANIFEST_PATH, parseManifest } from '../../../src/pipeline/manifest.js';
import { STATE_PATH, parseState, sha256 } from '../../../src/pipeline/state.js';
import { Logger } from '../../../src/logging/logger.js';
import type {
  GitHost,
  CommitInfo,
  CommitAndPushInput,
} from '../../../src/adapters/git-host/interface.js';
import type { WikiBackend } from '../../../src/adapters/wiki-backend/interface.js';
import { WikiNotFoundError } from '../../../src/adapters/wiki-backend/interface.js';
import type {
  LLMProvider,
  StructuredCompletionRequest,
} from '../../../src/adapters/llm-provider/interface.js';

const CONFIG_YAML = `
wiki_backend:
  organization: contoso
  project: docs
  wiki_identifier: team-wiki
llm:
  retry_limit: 2
  token_budget: 100000
`;

const MAPPING_YAML = `
mappings:
  - code_path: "src/api/**"
    wiki_path: "/API/Overview"
`;

const VALID_README = `# Project\n\n## Installation\n\nRun it.\n\n## Usage\n\nUse it.\n`;

function makeFakeGitHost(overrides: Partial<GitHost> & { commits?: CommitInfo[] } = {}): GitHost & {
  commitAndPush: ReturnType<typeof vi.fn>;
  commentOnMergeRequest: ReturnType<typeof vi.fn>;
} {
  return {
    name: 'fake-gitlab',
    diff:
      overrides.diff ??
      vi.fn().mockResolvedValue({
        raw: 'diff --git a/src/api/x.ts b/src/api/x.ts\n+ change',
        baseSha: 'base',
        headSha: 'HEAD',
      }),
    listCommitsInRange:
      overrides.listCommitsInRange ??
      vi
        .fn()
        .mockResolvedValue(
          overrides.commits ?? [
            { sha: 'abc', author: { name: 'A Human', email: 'h@h' }, message: 'feat: change' },
          ],
        ),
    commitAndPush: vi.fn().mockResolvedValue({ skipped: false, sha: 'newsha' }),
    commentOnMergeRequest: vi.fn().mockResolvedValue(undefined),
    openIssue: vi.fn(),
  } as unknown as GitHost & {
    commitAndPush: ReturnType<typeof vi.fn>;
    commentOnMergeRequest: ReturnType<typeof vi.fn>;
  };
}

function makeFakeWikiBackend(): WikiBackend {
  return {
    name: 'fake-ado',
    listPages: vi.fn(),
    getPage: vi.fn().mockRejectedValue(new WikiNotFoundError('/API/Overview')),
    createPage: vi.fn(),
    updatePage: vi.fn(),
  };
}

function makeFakeLlm(
  responses: unknown[],
): LLMProvider & { completeStructured: ReturnType<typeof vi.fn> } {
  const fn = vi.fn();
  for (const data of responses) {
    fn.mockResolvedValueOnce({
      data,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      model: 'test-model',
    });
  }
  return {
    name: 'fake-openrouter',
    completeStructured: fn as unknown as (r: StructuredCompletionRequest) => Promise<never>,
  } as unknown as LLMProvider & { completeStructured: ReturnType<typeof vi.fn> };
}

const VALID_PROPOSAL = {
  readme: { content: VALID_README },
  changelog: { category: 'Added', description: 'New API endpoint' },
  wikiPages: [
    { path: '/API/Overview', operation: 'create', content: '# API\n\n## Overview\n\ntext\n' },
  ],
};

describe('proposeCore', () => {
  let cwd: string;
  let config: DocStyleConfig;
  let mapping: MappingFile;
  let logger: Logger;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'docwelder-propose-'));
    config = parseDocStyleConfig(CONFIG_YAML);
    mapping = parseMapping(MAPPING_YAML);
    logger = new Logger({ sink: () => {} });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function baseDeps(overrides: Partial<ProposeCoreDeps> = {}): ProposeCoreDeps {
    return {
      gitHost: makeFakeGitHost(),
      createWikiBackend: () => makeFakeWikiBackend(),
      createLlmProvider: () => makeFakeLlm([VALID_PROPOSAL]),
      config,
      mapping,
      cwd,
      logger,
      env: {
        CI_MERGE_REQUEST_DIFF_BASE_SHA: 'base',
        CI_MERGE_REQUEST_IID: '42',
        CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'feature',
      },
      ...overrides,
    };
  }

  it('first-run happy path writes README, CHANGELOG, wiki page, manifest, and state', async () => {
    const deps = baseDeps();
    const exitCode = await proposeCore(deps);
    expect(exitCode).toBe(0);

    const commitCall = (deps.gitHost.commitAndPush as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as CommitAndPushInput;
    const paths = commitCall.changes.map((c) => c.path);
    expect(paths).toContain(join(cwd, 'README.md'));
    expect(paths).toContain(join(cwd, 'CHANGELOG.md'));
    expect(paths.some((p) => p.includes('wiki-staging/pages'))).toBe(true);
    expect(paths).toContain(join(cwd, MANIFEST_PATH));
    expect(paths).toContain(join(cwd, STATE_PATH));

    const manifestChange = commitCall.changes.find((c) => c.path === join(cwd, MANIFEST_PATH))!;
    const manifest = parseManifest(manifestChange.content!);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]?.operation).toBe('create');

    const stateChange = commitCall.changes.find((c) => c.path === join(cwd, STATE_PATH))!;
    const state = parseState(stateChange.content!);
    expect(state.artifacts.readme).toBe(sha256(VALID_README));

    expect(deps.gitHost.commentOnMergeRequest).toHaveBeenCalled();
  });

  it('retries once on validation failure then succeeds', async () => {
    const invalidProposal = {
      readme: { content: '# No required sections' },
      changelog: null,
      wikiPages: [],
    };
    const llm = makeFakeLlm([invalidProposal, { readme: null, changelog: null, wikiPages: [] }]);
    const deps = baseDeps({ createLlmProvider: () => llm });
    const exitCode = await proposeCore(deps);
    expect(exitCode).toBe(0);
    expect(llm.completeStructured).toHaveBeenCalledTimes(2);
    const secondCallMessages = llm.completeStructured.mock.calls[1][0].messages;
    expect(secondCallMessages.length).toBeGreaterThan(2);
    expect(secondCallMessages.some((m: { role: string }) => m.role === 'assistant')).toBe(true);
  });

  it('exhausts retries, posts MR comment with validator errors, and does not commit', async () => {
    const invalidProposal = {
      readme: { content: '# No required sections' },
      changelog: null,
      wikiPages: [],
    };
    // retry_limit is 2 -> up to 3 attempts total, all invalid
    const llm = makeFakeLlm([invalidProposal, invalidProposal, invalidProposal]);
    const deps = baseDeps({ createLlmProvider: () => llm });
    const exitCode = await proposeCore(deps);
    expect(exitCode).toBe(0);
    expect(deps.gitHost.commitAndPush).not.toHaveBeenCalled();
    const commentBody = (deps.gitHost.commentOnMergeRequest as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(commentBody).toContain('Missing required README section');
  });

  it('preserves a human-edited README across re-runs', async () => {
    writeFileSync(join(cwd, 'README.md'), '# Human edited README\n');
    const stateDir = join(cwd, '.docs/wiki-staging');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(cwd, STATE_PATH),
      JSON.stringify({
        artifacts: {
          readme: sha256('# Bot-authored README\n'),
          changelogEntry: null,
          wikiPages: {},
        },
      }),
    );

    const deps = baseDeps({ mapping: parseMapping('mappings: []') });
    const exitCode = await proposeCore(deps);
    expect(exitCode).toBe(0);
    if ((deps.gitHost.commitAndPush as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
      const commitCall = (deps.gitHost.commitAndPush as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as CommitAndPushInput;
      expect(commitCall.changes.find((c) => c.path === join(cwd, 'README.md'))).toBeUndefined();
    }
    const comments = (
      deps.gitHost.commentOnMergeRequest as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[1]);
    expect(
      comments.some((body: string) => body.includes('README.md') || body.includes('human edit')),
    ).toBe(true);
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('# Human edited README\n');
  });

  it('preserves a human-edited staged wiki page across re-runs', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(cwd, '.docs/wiki-staging/pages'), { recursive: true });
    writeFileSync(
      join(cwd, '.docs/wiki-staging/pages/api-overview.md'),
      '# Human edited wiki page\n',
    );
    writeFileSync(
      join(cwd, MANIFEST_PATH),
      'entries:\n  - wiki_path: /API/Overview\n    operation: create\n    local_file: pages/api-overview.md\n',
    );
    writeFileSync(
      join(cwd, STATE_PATH),
      JSON.stringify({
        artifacts: {
          readme: null,
          changelogEntry: null,
          wikiPages: { '/API/Overview': sha256('# Bot-authored content\n') },
        },
      }),
    );

    const llm = makeFakeLlm([
      {
        readme: null,
        changelog: null,
        wikiPages: [{ path: '/API/Overview', operation: 'update', content: 'new bot content' }],
      },
    ]);
    const deps = baseDeps({ createLlmProvider: () => llm });
    await proposeCore(deps);

    expect(readFileSync(join(cwd, '.docs/wiki-staging/pages/api-overview.md'), 'utf8')).toBe(
      '# Human edited wiki page\n',
    );
  });

  it('treats an empty/doc-only diff as a no-op and skips the LLM entirely', async () => {
    const gitHost = makeFakeGitHost({
      diff: vi.fn().mockResolvedValue({ raw: '', baseSha: 'base', headSha: 'HEAD' }),
    });
    const llm = makeFakeLlm([]);
    const deps = baseDeps({ gitHost, createLlmProvider: () => llm });
    const exitCode = await proposeCore(deps);
    expect(exitCode).toBe(0);
    expect(llm.completeStructured).not.toHaveBeenCalled();
    expect(gitHost.commitAndPush).not.toHaveBeenCalled();
    const body = gitHost.commentOnMergeRequest.mock.calls[0][1];
    expect(body).toContain('no documentation changes are required');
  });

  it('short-circuits via the recursion guard when only bot commits exist since the base', async () => {
    const gitHost = makeFakeGitHost({
      commits: [{ sha: 's', author: { name: BOT_AUTHOR_NAME, email: 'b@b' }, message: 'm' }],
    });
    const llm = makeFakeLlm([]);
    const deps = baseDeps({ gitHost, createLlmProvider: () => llm });
    const exitCode = await proposeCore(deps);
    expect(exitCode).toBe(0);
    expect(llm.completeStructured).not.toHaveBeenCalled();
    expect(gitHost.commentOnMergeRequest).toHaveBeenCalledWith(
      42,
      expect.stringContaining('last bot regeneration'),
    );
  });

  it('state written on one run is correctly re-read as ground truth on the next (state lifecycle)', async () => {
    const deps = baseDeps();
    await proposeCore(deps);
    const commitCall = (deps.gitHost.commitAndPush as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as CommitAndPushInput;
    for (const change of commitCall.changes) {
      if (change.content !== null) {
        const { mkdirSync } = await import('node:fs');
        mkdirSync(change.path.replace(/[^/]+$/, ''), { recursive: true });
        writeFileSync(change.path, change.content);
      }
    }
    expect(existsSync(join(cwd, STATE_PATH))).toBe(true);
    const state = parseState(readFileSync(join(cwd, STATE_PATH), 'utf8'));
    expect(state.artifacts.readme).toBe(sha256(VALID_README));

    // Simulate a fresh container/new run: re-run with the same (now on-disk) README -> eligible for regeneration.
    const gitHost2 = makeFakeGitHost();
    const llm2 = makeFakeLlm([VALID_PROPOSAL]);
    const exitCode2 = await proposeCore(
      baseDeps({ gitHost: gitHost2, createLlmProvider: () => llm2 }),
    );
    expect(exitCode2).toBe(0);
  });
});

describe('runPropose (env/registry wiring)', () => {
  let cwd: string;
  let originalEnv: NodeJS.ProcessEnv;
  const quietLogger = new Logger({ sink: () => {} });

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'docwelder-runpropose-'));
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(cwd, '.docs'), { recursive: true });
    writeFileSync(join(cwd, '.docs/config.yaml'), CONFIG_YAML);
    writeFileSync(join(cwd, '.docs/mapping.yaml'), MAPPING_YAML);
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(cwd, { recursive: true, force: true });
  });

  it('exits 1 when CI_PIPELINE_SOURCE is not merge_request_event', async () => {
    const { runPropose } = await import('../../../src/commands/propose.js');
    process.env.CI_PIPELINE_SOURCE = 'push';
    const exitCode = await runPropose({ logger: quietLogger, cwd });
    expect(exitCode).toBe(1);
  });

  it('exits 1 with an actionable error when config/mapping is missing', async () => {
    const { runPropose } = await import('../../../src/commands/propose.js');
    const emptyCwd = mkdtempSync(join(tmpdir(), 'docwelder-empty-'));
    process.env.CI_PIPELINE_SOURCE = 'merge_request_event';
    const exitCode = await runPropose({ logger: quietLogger, cwd: emptyCwd });
    expect(exitCode).toBe(1);
    rmSync(emptyCwd, { recursive: true, force: true });
  });

  it('exits 1 naming GITLAB_BOT_TOKEN when it is missing', async () => {
    const { runPropose } = await import('../../../src/commands/propose.js');
    process.env.CI_PIPELINE_SOURCE = 'merge_request_event';
    delete process.env.GITLAB_BOT_TOKEN;
    process.env.CI_SERVER_HOST = 'gitlab.example.com';
    process.env.CI_PROJECT_ID = '1';
    process.env.CI_PROJECT_PATH = 'group/project';
    const lines: string[] = [];
    const capturingLogger = new Logger({ sink: (l) => lines.push(l) });
    const exitCode = await runPropose({ logger: capturingLogger, cwd });
    expect(exitCode).toBe(1);
    expect(lines.some((l) => l.includes('GITLAB_BOT_TOKEN'))).toBe(true);
  });

  it('exits 1 naming OPENROUTER_API_KEY when it is missing and the LLM is actually needed', async () => {
    process.env.GITLAB_BOT_TOKEN = 'token';
    process.env.CI_SERVER_HOST = 'gitlab.example.com';
    process.env.CI_PROJECT_ID = '1';
    process.env.CI_PROJECT_PATH = 'group/project';
    process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA = 'base';
    process.env.CI_MERGE_REQUEST_IID = '42';
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ADO_WIKI_PAT;

    const config = parseDocStyleConfig(CONFIG_YAML);
    const mapping = parseMapping('mappings: []');
    const lines: string[] = [];
    const capturingLogger = new Logger({ sink: (l) => lines.push(l) });
    const { llmProviderRegistry } = await import('../../../src/adapters/llm-provider/registry.js');
    const { EnvCredentialSource } = await import('../../../src/adapters/registry.js');

    const exitCode = await proposeCore({
      gitHost: makeFakeGitHost({
        diff: vi.fn().mockResolvedValue({
          raw: 'diff --git a/src/x.ts b/src/x.ts\n+y',
          baseSha: 'base',
          headSha: 'HEAD',
        }),
      }),
      createWikiBackend: () => makeFakeWikiBackend(),
      createLlmProvider: () =>
        llmProviderRegistry.create('openrouter', new EnvCredentialSource(), undefined),
      config,
      mapping,
      cwd,
      logger: capturingLogger,
      env: process.env,
    }).catch((err: Error) => {
      capturingLogger.error(err.message);
      return 1;
    });

    expect(exitCode).toBe(1);
    expect(lines.some((l) => l.includes('OPENROUTER_API_KEY'))).toBe(true);
  });
});

describe('isNoOpDiff', () => {
  it('is true for an empty diff', () => {
    expect(isNoOpDiff('')).toBe(true);
  });

  it('is true when only test/doc files changed', () => {
    const diff =
      'diff --git a/README.md b/README.md\n+x\ndiff --git a/src/foo.test.ts b/src/foo.test.ts\n+y';
    expect(isNoOpDiff(diff)).toBe(true);
  });

  it('is false when a source file changed', () => {
    const diff = 'diff --git a/src/api/handler.ts b/src/api/handler.ts\n+x';
    expect(isNoOpDiff(diff)).toBe(false);
  });
});
