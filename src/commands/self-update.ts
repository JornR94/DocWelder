import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Logger } from '../logging/logger.js';
import { DOCWELDER_VERSION } from '../version.js';
import { compareSemver, DEFAULT_VERSION_FEED_URL, fetchLatestVersion } from '../version-feed.js';

export interface SelfUpdateOptions {
  logger: Logger;
  pinFilePath?: string;
  feedUrl?: string;
  fetchImpl?: typeof fetch;
}

export function defaultPinFilePath(): string {
  return join(homedir(), '.config', 'docwelder', 'pinned-image-tag');
}

/**
 * Rewrites the local wrapper's pinned image tag (task 14.10). The wrapper
 * always bind-mounts `~/.config/docwelder/`, so this override file — read by
 * the wrapper at every invocation, falling back to the tag baked in at
 * install time when absent — lets `self-update` take effect without a
 * second mount.
 */
export async function runSelfUpdate(options: SelfUpdateOptions): Promise<number> {
  const { logger } = options;
  const pinFilePath = options.pinFilePath ?? defaultPinFilePath();

  let currentVersion: string;
  try {
    currentVersion = readFileSync(pinFilePath, 'utf8').trim();
  } catch {
    currentVersion = DOCWELDER_VERSION;
  }

  let latestVersion: string;
  try {
    latestVersion = await fetchLatestVersion(
      options.feedUrl ?? DEFAULT_VERSION_FEED_URL,
      options.fetchImpl ?? fetch,
    );
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  if (compareSemver(latestVersion, currentVersion) <= 0) {
    logger.info(`Already up to date at version ${currentVersion}. No update needed.`);
    return 0;
  }

  mkdirSync(dirname(pinFilePath), { recursive: true });
  writeFileSync(pinFilePath, `${latestVersion}\n`);
  logger.info(`Updated pinned image tag from ${currentVersion} to ${latestVersion}.`);
  return 0;
}
