import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../logging/logger.js';
import { compareSemver, DEFAULT_VERSION_FEED_URL, fetchLatestVersion } from '../version-feed.js';

export interface UpgradeOptions {
  logger: Logger;
  cwd?: string;
  feedUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Matches the Docwelder CI include's versioned URL, e.g.:
 *   https://raw.githubusercontent.com/JornR94/DocWelder/v1.2.3/release/ci-template.yml
 * Captures the `MAJOR.MINOR.PATCH` segment so it can be rewritten in place.
 */
const INCLUDE_URL_PATTERN =
  /(https:\/\/raw\.githubusercontent\.com\/JornR94\/DocWelder\/v)(\d+\.\d+\.\d+)(\/release\/ci-template\.yml)/;

export async function runUpgrade(options: UpgradeOptions): Promise<number> {
  const { logger } = options;
  const cwd = options.cwd ?? process.cwd();
  const ciFilePath = join(cwd, '.gitlab-ci.yml');

  let raw: string;
  try {
    raw = readFileSync(ciFilePath, 'utf8');
  } catch {
    logger.error(
      `No .gitlab-ci.yml found at ${ciFilePath}. Run \`docwelder init\` first to onboard this repository.`,
    );
    return 1;
  }

  const match = INCLUDE_URL_PATTERN.exec(raw);
  if (!match) {
    logger.error(
      `${ciFilePath} does not contain a recognizable Docwelder remote include line. ` +
        'Run `docwelder init` to add one, or check for manual edits to the include URL.',
    );
    return 1;
  }
  const currentVersion = match[2]!;

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
    logger.info(`Already up to date at version ${currentVersion}. No upgrade needed.`);
    return 0;
  }

  const updated = raw.replace(INCLUDE_URL_PATTERN, `$1${latestVersion}$3`);
  writeFileSync(ciFilePath, updated);
  logger.info(`Upgraded ${ciFilePath} from ${currentVersion} to ${latestVersion}.`);
  return 0;
}
