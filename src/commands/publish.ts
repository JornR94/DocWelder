import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { GitHost } from '../adapters/git-host/interface.js';
import { gitHostRegistry } from '../adapters/git-host/registry.js';
import type { WikiBackend } from '../adapters/wiki-backend/interface.js';
import { WikiConflictError } from '../adapters/wiki-backend/interface.js';
import { wikiBackendRegistry } from '../adapters/wiki-backend/registry.js';
import { EnvCredentialSource } from '../adapters/registry.js';
import { loadDocStyleConfig } from '../config/doc-style-config.js';
import { ConfigValidationError } from '../config/errors.js';
import {
  MANIFEST_PATH,
  WIKI_STAGING_DIR,
  parseManifest,
  type ManifestEntry,
} from '../pipeline/manifest.js';
import type { Logger } from '../logging/logger.js';

export interface PublishOptions {
  logger: Logger;
  cwd?: string;
}

export interface PublishCoreDeps {
  gitHost: GitHost;
  wikiBackend: WikiBackend;
  cwd: string;
  logger: Logger;
  env: Record<string, string | undefined>;
}

type EntryOutcome = 'success' | 'conflict' | 'error';

interface EntryResult {
  entry: ManifestEntry;
  outcome: EntryOutcome;
  reason?: string;
}

/** Core publish logic with all I/O boundaries injected, for testability. */
export async function publishCore(deps: PublishCoreDeps): Promise<number> {
  const { gitHost, wikiBackend, cwd, logger, env } = deps;

  if (env.CI_COMMIT_BRANCH !== env.CI_DEFAULT_BRANCH) {
    logger.error(
      'docwelder publish is designed to run on pushes to the default branch ' +
        `(CI_COMMIT_BRANCH=${env.CI_COMMIT_BRANCH ?? '(unset)'}, CI_DEFAULT_BRANCH=${env.CI_DEFAULT_BRANCH ?? '(unset)'}).`,
    );
    return 1;
  }

  const manifestPath = join(cwd, MANIFEST_PATH);
  if (!existsSync(manifestPath)) {
    logger.info('No .docs/wiki-staging/manifest.yaml present; nothing to publish.');
    return 0;
  }

  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  const results: EntryResult[] = [];

  for (const entry of manifest.entries) {
    const localFilePath = join(cwd, WIKI_STAGING_DIR, entry.local_file);
    const content = readFileSync(localFilePath, 'utf8');

    try {
      if (entry.operation === 'create') {
        await wikiBackend.createPage(entry.wiki_path, content);
      } else {
        const current = await wikiBackend.getPage(entry.wiki_path);
        if (current.etag !== entry.source_etag) {
          results.push({
            entry,
            outcome: 'conflict',
            reason: `ETag mismatch: wiki page "${entry.wiki_path}" was changed externally since propose ran (expected ${entry.source_etag}, found ${current.etag}).`,
          });
          continue;
        }
        await wikiBackend.updatePage(entry.wiki_path, content, entry.source_etag!);
      }
      results.push({ entry, outcome: 'success' });
    } catch (err) {
      if (err instanceof WikiConflictError) {
        results.push({ entry, outcome: 'conflict', reason: err.message });
      } else {
        results.push({
          entry,
          outcome: 'error',
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  for (const result of results) {
    logger.info(`${result.entry.wiki_path}: ${result.outcome}`, { reason: result.reason });
  }

  const failures = results.filter((r) => r.outcome !== 'success');

  if (failures.length > 0) {
    const issueBody = [
      'docwelder publish failed to fully publish staged wiki changes:',
      '',
      ...failures.map((f) => `- ${f.entry.wiki_path} (${f.outcome}): ${f.reason}`),
      '',
      'Staged files were left in place for a subsequent re-run to reconcile.',
    ].join('\n');

    let issueUrl = '(unavailable)';
    try {
      const issue = await gitHost.openIssue({
        title: `Docwelder publish failures: ${failures.length} wiki page(s)`,
        description: issueBody,
      });
      issueUrl = issue.url;
    } catch (err) {
      logger.error(
        `Failed to open a GitLab issue for publish failures: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const originatingMrIid = env.CI_MERGE_REQUEST_IID ? Number(env.CI_MERGE_REQUEST_IID) : NaN;
    if (!Number.isNaN(originatingMrIid)) {
      try {
        await gitHost.commentOnMergeRequest(
          originatingMrIid,
          `Docwelder publish encountered ${failures.length} failure(s) publishing staged wiki changes. See ${issueUrl} for details.`,
        );
      } catch (err) {
        logger.error(
          `Failed to comment on the originating MR: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      logger.warn('CI_MERGE_REQUEST_IID not set; could not comment on the originating MR.');
    }

    logger.error(
      `Publish completed with ${failures.length} failing entr${failures.length === 1 ? 'y' : 'ies'}.`,
    );
    return 1;
  }

  rmSync(join(cwd, WIKI_STAGING_DIR), { recursive: true, force: true });
  const commitResult = await gitHost.commitAndPush({
    branch: env.CI_COMMIT_BRANCH ?? 'main',
    message: 'docwelder: clean up published wiki staging',
    changes: [{ path: WIKI_STAGING_DIR, content: null }],
  });
  logger.info(
    commitResult.skipped
      ? 'Staging tree already clean; nothing to commit.'
      : `Removed ${WIKI_STAGING_DIR} in commit ${commitResult.sha}.`,
  );
  return 0;
}

export async function runPublish(options: PublishOptions): Promise<number> {
  const { logger } = options;
  const cwd = options.cwd ?? process.cwd();
  const env = process.env;

  if (env.CI_COMMIT_BRANCH !== env.CI_DEFAULT_BRANCH) {
    logger.error(
      'docwelder publish is designed to run on pushes to the default branch ' +
        `(CI_COMMIT_BRANCH=${env.CI_COMMIT_BRANCH ?? '(unset)'}, CI_DEFAULT_BRANCH=${env.CI_DEFAULT_BRANCH ?? '(unset)'}).`,
    );
    return 1;
  }

  let config;
  try {
    config = loadDocStyleConfig(join(cwd, '.docs', 'config.yaml'));
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      logger.error(err.message);
      return 1;
    }
    throw err;
  }

  const credentialSource = new EnvCredentialSource();

  let gitHost: GitHost;
  try {
    gitHost = gitHostRegistry.create('gitlab', credentialSource, {
      serverHost: env.CI_SERVER_HOST ?? '',
      projectId: env.CI_PROJECT_ID ?? '',
      projectPath: env.CI_PROJECT_PATH ?? '',
      apiBaseUrl: env.CI_API_V4_URL,
    });
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  let wikiBackend: WikiBackend;
  try {
    wikiBackend = wikiBackendRegistry.create('azure-devops-wiki', credentialSource, {
      organization: config.wiki_backend.organization,
      project: config.wiki_backend.project,
      wikiIdentifier: config.wiki_backend.wiki_identifier,
    });
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  return publishCore({ gitHost, wikiBackend, cwd, logger, env });
}
