import { describe, expect, it } from 'vitest';
import { compareSemver, fetchLatestVersion, VersionFeedError } from '../../src/version-feed.js';

function fakeFetch(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status })) as unknown as typeof fetch;
}

describe('compareSemver', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.1', '1.0.0')).toBe(1);
    expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
    expect(compareSemver('1.9.9', '2.0.0')).toBe(-1);
    expect(compareSemver('1.2.0', '1.10.0')).toBe(-1);
  });
});

describe('fetchLatestVersion', () => {
  it('returns the trimmed version on a 200 response', async () => {
    const version = await fetchLatestVersion(
      'https://example.test/VERSION',
      fakeFetch(200, '1.2.3\n'),
    );
    expect(version).toBe('1.2.3');
  });

  it('throws VersionFeedError on a non-2xx response', async () => {
    await expect(
      fetchLatestVersion('https://example.test/VERSION', fakeFetch(404, '')),
    ).rejects.toThrow(VersionFeedError);
  });

  it('throws VersionFeedError when the body is not a semver string', async () => {
    await expect(
      fetchLatestVersion('https://example.test/VERSION', fakeFetch(200, 'not-a-version')),
    ).rejects.toThrow(VersionFeedError);
  });

  it('throws VersionFeedError when the fetch itself rejects', async () => {
    const throwing: typeof fetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(fetchLatestVersion('https://example.test/VERSION', throwing)).rejects.toThrow(
      VersionFeedError,
    );
  });
});
