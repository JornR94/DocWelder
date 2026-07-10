import { describe, expect, it, vi } from 'vitest';
import { AdoWikiBackend } from '../../../../src/adapters/wiki-backend/ado.js';
import {
  WikiConflictError,
  WikiNotFoundError,
} from '../../../../src/adapters/wiki-backend/interface.js';

interface FakeCall {
  url: string;
  init: RequestInit;
}

interface FakeResponseSpec {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

function fakeResponse(spec: FakeResponseSpec): Response {
  return new Response(spec.body === undefined ? undefined : JSON.stringify(spec.body), {
    status: spec.status,
    headers: spec.headers,
  });
}

function buildFakeFetch(responses: FakeResponseSpec[]): {
  fetchImpl: typeof fetch;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  let index = 0;
  const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: input.toString(), init: init ?? {} });
    const spec = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return fakeResponse(spec);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function makeBackend(
  fetchImpl: typeof fetch,
  overrides: Partial<{ maxRetries: number; retryBaseMs: number }> = {},
) {
  return new AdoWikiBackend({
    organization: 'acme-org',
    project: 'acme-project',
    wikiIdentifier: 'acme.wiki',
    personalAccessToken: 'fake-pat',
    fetchImpl,
    maxRetries: overrides.maxRetries ?? 3,
    retryBaseMs: overrides.retryBaseMs ?? 1,
  });
}

describe('AdoWikiBackend', () => {
  it('listPages flattens the page tree and ranks the best match first', async () => {
    const tree = {
      path: '/',
      subPages: [
        {
          path: '/Widgets',
          subPages: [{ path: '/Widgets/Installation-Guide', subPages: [] }],
        },
        { path: '/Unrelated-Topic', subPages: [] },
      ],
    };
    const { fetchImpl, calls } = buildFakeFetch([{ status: 200, body: tree }]);
    const backend = makeBackend(fetchImpl);

    const results = await backend.listPages({
      repoName: 'widgets',
      pathSegments: ['installation', 'guide'],
      keywords: [],
    });

    expect(calls[0]!.url).toContain('recursionLevel=Full');
    expect(results[0]!.path).toBe('/Widgets/Installation-Guide');
    expect(results[0]!.matchScore).toBeGreaterThan(
      results.find((r) => r.path === '/Unrelated-Topic')!.matchScore,
    );
    expect(results.map((r) => r.path)).toContain('/Widgets');
  });

  it('getPage returns content and etag from headers', async () => {
    const { fetchImpl } = buildFakeFetch([
      { status: 200, headers: { ETag: '"abc123"' }, body: { content: '# Hello' } },
    ]);
    const backend = makeBackend(fetchImpl);

    const page = await backend.getPage('/Widgets/Installation-Guide');
    expect(page).toEqual({
      path: '/Widgets/Installation-Guide',
      content: '# Hello',
      etag: '"abc123"',
    });
  });

  it('getPage throws WikiNotFoundError on 404', async () => {
    const { fetchImpl } = buildFakeFetch([{ status: 404 }]);
    const backend = makeBackend(fetchImpl);

    await expect(backend.getPage('/Missing')).rejects.toBeInstanceOf(WikiNotFoundError);
  });

  it('createPage issues exactly one PUT at the full nested path with no If-Match', async () => {
    const { fetchImpl, calls } = buildFakeFetch([{ status: 200, headers: { ETag: '"new-etag"' } }]);
    const backend = makeBackend(fetchImpl);

    const result = await backend.createPage('/A/B/C', '# New Page');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe('PUT');
    expect(calls[0]!.url).toContain(encodeURIComponent('/A/B/C'));
    expect(new Headers(calls[0]!.init.headers).has('If-Match')).toBe(false);
    expect(result).toEqual({ etag: '"new-etag"' });
  });

  it('updatePage sends If-Match and succeeds on a matching etag', async () => {
    const { fetchImpl, calls } = buildFakeFetch([
      { status: 200, headers: { ETag: '"updated-etag"' } },
    ]);
    const backend = makeBackend(fetchImpl);

    const result = await backend.updatePage('/Widgets/Guide', '# Updated', '"old-etag"');

    expect(new Headers(calls[0]!.init.headers).get('If-Match')).toBe('"old-etag"');
    expect(result).toEqual({ etag: '"updated-etag"' });
  });

  it('updatePage throws WikiConflictError on 412 and makes no further request', async () => {
    const { fetchImpl, calls } = buildFakeFetch([{ status: 412 }]);
    const backend = makeBackend(fetchImpl);

    await expect(backend.updatePage('/Widgets/Guide', '# Updated', '"stale-etag"')).rejects.toThrow(
      WikiConflictError,
    );
    expect(calls).toHaveLength(1);
  });

  it('retries on 429 respecting Retry-After and eventually succeeds', async () => {
    const { fetchImpl, calls } = buildFakeFetch([
      { status: 429, headers: { 'Retry-After': '0' } },
      { status: 429 },
      { status: 200, headers: { ETag: '"final-etag"' }, body: { content: 'ok' } },
    ]);
    const backend = makeBackend(fetchImpl, { retryBaseMs: 1 });

    const page = await backend.getPage('/Retried');

    expect(calls).toHaveLength(3);
    expect(page.etag).toBe('"final-etag"');
  });

  it('surfaces a clear error once retries are exhausted on persistent 429s', async () => {
    const { fetchImpl } = buildFakeFetch([
      { status: 429 },
      { status: 429 },
      { status: 429 },
      { status: 429 },
    ]);
    const backend = makeBackend(fetchImpl, { maxRetries: 2, retryBaseMs: 1 });

    await expect(backend.getPage('/AlwaysLimited')).rejects.toThrow(/rate-limited/);
  });
});
