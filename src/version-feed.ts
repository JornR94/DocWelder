/**
 * "Latest available version" lookup shared by `docwelder upgrade` (repo CI
 * template pin) and `docwelder self-update` (local wrapper image pin).
 *
 * MVP resolves Open Question #13 (proposal) as: NO signing. The feed is just
 * the plain-text contents of this repo's own `VERSION` file, served over
 * HTTPS from the `main` branch — reusing the single-source-of-truth version
 * file (task 1.5) instead of standing up separate release-feed
 * infrastructure. Signing the feed (so `upgrade`/`self-update` can verify
 * authenticity beyond "HTTPS to the known repo") is a documented future
 * hardening step, not present in MVP.
 */
export const DEFAULT_VERSION_FEED_URL =
  'https://raw.githubusercontent.com/JornR94/DocWelder/main/VERSION';

export class VersionFeedError extends Error {
  constructor(
    public readonly feedUrl: string,
    message: string,
  ) {
    super(message);
    this.name = 'VersionFeedError';
  }
}

export async function fetchLatestVersion(
  feedUrl: string = DEFAULT_VERSION_FEED_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(feedUrl);
  } catch (err) {
    throw new VersionFeedError(
      feedUrl,
      `Unable to reach version feed at ${feedUrl}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    throw new VersionFeedError(
      feedUrl,
      `Version feed at ${feedUrl} responded with HTTP ${response.status}`,
    );
  }
  const text = await response.text();
  const trimmed = text.trim();
  if (!/^\d+\.\d+\.\d+$/.test(trimmed)) {
    throw new VersionFeedError(
      feedUrl,
      `Version feed at ${feedUrl} did not return a MAJOR.MINOR.PATCH version (got: "${trimmed}")`,
    );
  }
  return trimmed;
}

/** Standard three-way comparator for `MAJOR.MINOR.PATCH` strings: -1, 0, or 1. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const partsA = parseSemver(a);
  const partsB = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    const diff = partsA[i]! - partsB[i]!;
    if (diff > 0) return 1;
    if (diff < 0) return -1;
  }
  return 0;
}

function parseSemver(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) {
    throw new Error(`Not a MAJOR.MINOR.PATCH version: "${version}"`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
