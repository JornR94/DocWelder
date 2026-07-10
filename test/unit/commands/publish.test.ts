import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '../../../src/logging/logger.js';
import type { GitHost, OpenIssueResult } from '../../../src/adapters/git-host/interface.js';
import {
  WikiConflictError,
  type WikiBackend,
} from '../../../src/adapters/wiki-backend/interface.js';
import { WIKI_STAGING_DIR } from '../../../src/pipeline/manifest.js';
import { publishCore } from '../../../src/commands/publish.js';

function makeLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  return { logger: new Logger({ sink: (line) => lines.push(line) }), lines };
}

function makeGitHost(overrides: Partial<GitHost> = {}): GitHost {
  return {
    name: 'gitlab',
    diff: vi.fn(),
    listCommitsInRange: vi.fn(),
    commitAndPush: vi.fn().mockResolvedValue({ skipped: false, sha: 'deadbeef' }),
    commentOnMergeRequest: vi.fn().mockResolvedValue(undefined),
    openIssue: vi.fn(async (): Promise<OpenIssueResult> => ({
      iid: 7,
      url: `https://example/issues/7`,
    })),
    ...overrides,
  };
}

function writeManifestFixture(
  cwd: string,
  entries: {
    wiki_path: string;
    operation: 'create' | 'update';
    local_file: string;
    source_etag?: string;
  }[],
): void {
  mkdirSync(join(cwd, WIKI_STAGING_DIR, 'pages'), { recursive: true });
  for (const entry of entries) {
    writeFileSync(
      join(cwd, WIKI_STAGING_DIR, entry.local_file),
      `# ${entry.wiki_path}\n\ncontent\n`,
    );
  }
  const yamlLines = ['entries:'];
  for (const entry of entries) {
    yamlLines.push(`  - wiki_path: ${entry.wiki_path}`);
    yamlLines.push(`    operation: ${entry.operation}`);
    yamlLines.push(`    local_file: ${entry.local_file}`);
    if (entry.source_etag) yamlLines.push(`    source_etag: "${entry.source_etag}"`);
  }
  writeFileSync(join(cwd, WIKI_STAGING_DIR, 'manifest.yaml'), yamlLines.join('\n') + '\n');
}

const BASE_ENV = { CI_COMMIT_BRANCH: 'main', CI_DEFAULT_BRANCH: 'main' };

describe('publishCore', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'docwelder-publish-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns 1 when not running on the default branch', async () => {
    const { logger } = makeLogger();
    const gitHost = makeGitHost();
    const wikiBackend = {} as WikiBackend;
    const code = await publishCore({
      gitHost,
      wikiBackend,
      cwd,
      logger,
      env: { CI_COMMIT_BRANCH: 'feature', CI_DEFAULT_BRANCH: 'main' },
    });
    expect(code).toBe(1);
  });

  it('returns 0 and never contacts the wiki backend when no manifest is present', async () => {
    const { logger } = makeLogger();
    const gitHost = makeGitHost();
    const wikiBackend: WikiBackend = {
      name: 'azure-devops-wiki',
      listPages: vi.fn(),
      getPage: vi.fn(),
      createPage: vi.fn(),
      updatePage: vi.fn(),
    };
    const code = await publishCore({ gitHost, wikiBackend, cwd, logger, env: BASE_ENV });
    expect(code).toBe(0);
    expect(wikiBackend.getPage).not.toHaveBeenCalled();
    expect(wikiBackend.createPage).not.toHaveBeenCalled();
  });

  it('happy path: create + matching-etag update both succeed, cleans up staging, no issue', async () => {
    writeManifestFixture(cwd, [
      { wiki_path: '/New/Page', operation: 'create', local_file: 'pages/new-page.md' },
      {
        wiki_path: '/API/Overview',
        operation: 'update',
        local_file: 'pages/api-overview.md',
        source_etag: 'etag-1',
      },
    ]);
    const { logger } = makeLogger();
    const gitHost = makeGitHost();
    const wikiBackend: WikiBackend = {
      name: 'azure-devops-wiki',
      listPages: vi.fn(),
      getPage: vi.fn().mockResolvedValue({ path: '/API/Overview', content: 'old', etag: 'etag-1' }),
      createPage: vi.fn().mockResolvedValue({ etag: 'etag-new' }),
      updatePage: vi.fn().mockResolvedValue({ etag: 'etag-2' }),
    };

    const code = await publishCore({ gitHost, wikiBackend, cwd, logger, env: BASE_ENV });

    expect(code).toBe(0);
    expect(wikiBackend.createPage).toHaveBeenCalledWith('/New/Page', expect.any(String));
    expect(wikiBackend.updatePage).toHaveBeenCalledWith(
      '/API/Overview',
      expect.any(String),
      'etag-1',
    );
    expect(gitHost.openIssue).not.toHaveBeenCalled();
    expect(gitHost.commitAndPush).toHaveBeenCalledTimes(1);
    expect(existsSync(join(cwd, WIKI_STAGING_DIR))).toBe(false);
  });

  it('ETag mismatch on one entry: records a conflict, processes the rest, opens an issue, no cleanup', async () => {
    writeManifestFixture(cwd, [
      { wiki_path: '/A', operation: 'update', local_file: 'pages/a.md', source_etag: 'stale-etag' },
      { wiki_path: '/B', operation: 'create', local_file: 'pages/b.md' },
    ]);
    const { logger } = makeLogger();
    const gitHost = makeGitHost();
    const wikiBackend: WikiBackend = {
      name: 'azure-devops-wiki',
      listPages: vi.fn(),
      getPage: vi.fn().mockResolvedValue({ path: '/A', content: 'live', etag: 'live-etag' }),
      createPage: vi.fn().mockResolvedValue({ etag: 'etag-new' }),
      updatePage: vi.fn(),
    };

    const code = await publishCore({
      gitHost,
      wikiBackend,
      cwd,
      logger,
      env: { ...BASE_ENV, CI_MERGE_REQUEST_IID: '42' },
    });

    expect(code).toBe(1);
    expect(wikiBackend.updatePage).not.toHaveBeenCalled();
    expect(wikiBackend.createPage).toHaveBeenCalledWith('/B', expect.any(String));
    expect(gitHost.openIssue).toHaveBeenCalledTimes(1);
    expect(gitHost.commentOnMergeRequest).toHaveBeenCalledWith(
      42,
      expect.stringContaining('issues/7'),
    );
    expect(gitHost.commitAndPush).not.toHaveBeenCalled();
    expect(existsSync(join(cwd, WIKI_STAGING_DIR, 'manifest.yaml'))).toBe(true);
  });

  it('a thrown error on one entry (e.g. ADO 5xx) is recorded, other entries still processed', async () => {
    writeManifestFixture(cwd, [
      { wiki_path: '/Broken', operation: 'create', local_file: 'pages/broken.md' },
      { wiki_path: '/Fine', operation: 'create', local_file: 'pages/fine.md' },
    ]);
    const { logger } = makeLogger();
    const gitHost = makeGitHost();
    const wikiBackend: WikiBackend = {
      name: 'azure-devops-wiki',
      listPages: vi.fn(),
      getPage: vi.fn(),
      createPage: vi
        .fn()
        .mockRejectedValueOnce(new Error('ADO returned 503'))
        .mockResolvedValueOnce({ etag: 'etag-new' }),
      updatePage: vi.fn(),
    };

    const code = await publishCore({ gitHost, wikiBackend, cwd, logger, env: BASE_ENV });

    expect(code).toBe(1);
    expect(wikiBackend.createPage).toHaveBeenCalledTimes(2);
    expect(gitHost.openIssue).toHaveBeenCalledTimes(1);
    expect(gitHost.commitAndPush).not.toHaveBeenCalled();
  });

  it('a WikiConflictError thrown by updatePage itself is recorded as a conflict', async () => {
    writeManifestFixture(cwd, [
      { wiki_path: '/A', operation: 'update', local_file: 'pages/a.md', source_etag: 'etag-1' },
    ]);
    const { logger } = makeLogger();
    const gitHost = makeGitHost();
    const wikiBackend: WikiBackend = {
      name: 'azure-devops-wiki',
      listPages: vi.fn(),
      getPage: vi.fn().mockResolvedValue({ path: '/A', content: 'old', etag: 'etag-1' }),
      createPage: vi.fn(),
      updatePage: vi.fn().mockRejectedValue(new WikiConflictError('/A', 'etag-1')),
    };

    const code = await publishCore({ gitHost, wikiBackend, cwd, logger, env: BASE_ENV });
    expect(code).toBe(1);
    expect(gitHost.openIssue).toHaveBeenCalledTimes(1);
  });
});
