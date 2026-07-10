import type { WikiBackend, WikiPageSummary, WikiScanQuery } from './interface.js';
import { WikiConflictError, WikiNotFoundError } from './interface.js';

const API_VERSION = '7.1';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 500;

export interface AdoWikiBackendConfig {
  organization: string;
  project: string;
  wikiIdentifier: string;
  personalAccessToken: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryBaseMs?: number;
}

interface AdoPageTreeNode {
  path: string;
  content?: string;
  subPages?: AdoPageTreeNode[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pathName(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1]! : path;
}

function flattenTree(node: AdoPageTreeNode, acc: { path: string; name: string }[]): void {
  if (node.path) {
    acc.push({ path: node.path, name: pathName(node.path) });
  }
  for (const child of node.subPages ?? []) {
    flattenTree(child, acc);
  }
}

function tokenize(value: string): string[] {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 0);
}

function scoreMatch(page: { path: string; name: string }, query: WikiScanQuery): number {
  const tokens = [
    ...tokenize(query.repoName),
    ...query.pathSegments.flatMap(tokenize),
    ...query.keywords.flatMap(tokenize),
  ];
  if (tokens.length === 0) return 0;

  const haystack = `${page.path} ${page.name}`.toLowerCase();
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  return Math.min(1, matched / tokens.length);
}

/** Azure DevOps Wiki `WikiBackend` implementation (MVP). */
export class AdoWikiBackend implements WikiBackend {
  readonly name = 'azure-devops-wiki';

  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(config: AdoWikiBackendConfig) {
    this.baseUrl = `https://dev.azure.com/${config.organization}/${config.project}/_apis/wiki/wikis/${config.wikiIdentifier}`;
    this.authHeader = `Basic ${Buffer.from(`:${config.personalAccessToken}`).toString('base64')}`;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseMs = config.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  }

  async listPages(query: WikiScanQuery): Promise<WikiPageSummary[]> {
    const url = `${this.baseUrl}/pages?path=${encodeURIComponent('/')}&recursionLevel=Full&includeContent=false&api-version=${API_VERSION}`;
    const response = await this.request(url, { method: 'GET' });
    const tree = (await response.json()) as AdoPageTreeNode;
    const flat: { path: string; name: string }[] = [];
    flattenTree(tree, flat);
    return flat
      .map((page) => ({ ...page, matchScore: scoreMatch(page, query) }))
      .sort((a, b) => b.matchScore - a.matchScore);
  }

  async getPage(path: string): Promise<{ path: string; content: string; etag: string }> {
    const url = `${this.baseUrl}/pages?path=${encodeURIComponent(path)}&includeContent=true&api-version=${API_VERSION}`;
    const response = await this.request(url, { method: 'GET' }, path);
    const etag = response.headers.get('etag') ?? '';
    const body = (await response.json()) as { content?: string };
    return { path, content: body.content ?? '', etag };
  }

  async createPage(path: string, content: string): Promise<{ etag: string }> {
    const url = `${this.baseUrl}/pages?path=${encodeURIComponent(path)}&api-version=${API_VERSION}`;
    const response = await this.request(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return { etag: response.headers.get('etag') ?? '' };
  }

  async updatePage(path: string, content: string, ifMatchEtag: string): Promise<{ etag: string }> {
    const url = `${this.baseUrl}/pages?path=${encodeURIComponent(path)}&api-version=${API_VERSION}`;
    const response = await this.request(
      url,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': ifMatchEtag },
        body: JSON.stringify({ content }),
      },
      path,
      ifMatchEtag,
    );
    return { etag: response.headers.get('etag') ?? '' };
  }

  /** Shared auth header + 429 retry-with-backoff + 404/412 error mapping for every call. */
  private async request(
    url: string,
    init: RequestInit,
    pathForErrors?: string,
    ifMatchEtagForConflict?: string,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', this.authHeader);

    let attempt = 0;
    for (;;) {
      const response = await this.fetchImpl(url, { ...init, headers });

      if (response.status === 429) {
        if (attempt >= this.maxRetries) {
          throw new Error(
            `Azure DevOps Wiki request to ${url} was rate-limited ${attempt + 1} times and exhausted retries`,
          );
        }
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
        const backoffMs =
          retryAfterMs && Number.isFinite(retryAfterMs)
            ? retryAfterMs
            : this.retryBaseMs * 2 ** attempt;
        attempt += 1;
        await sleep(backoffMs);
        continue;
      }

      if (response.status === 404 && pathForErrors !== undefined) {
        throw new WikiNotFoundError(pathForErrors);
      }

      if (response.status === 412 && pathForErrors !== undefined) {
        throw new WikiConflictError(pathForErrors, ifMatchEtagForConflict ?? '');
      }

      if (!response.ok) {
        throw new Error(
          `Azure DevOps Wiki request to ${url} failed with status ${response.status}`,
        );
      }

      return response;
    }
  }
}
