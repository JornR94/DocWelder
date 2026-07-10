export interface WikiPageSummary {
  path: string;
  name: string;
  /** 0 (no match) to 1 (exact match) — used to rank candidates during `docwelder init`'s wiki scan. */
  matchScore: number;
}

export interface WikiPage {
  path: string;
  content: string;
  etag: string;
}

/** Thrown by {@link WikiBackend.updatePage} on a 412 Precondition Failed (ETag mismatch). */
export class WikiConflictError extends Error {
  constructor(
    public readonly path: string,
    public readonly expectedEtag: string,
  ) {
    super(`ETag mismatch updating wiki page "${path}" (expected ${expectedEtag})`);
    this.name = 'WikiConflictError';
  }
}

export class WikiNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`Wiki page not found: "${path}"`);
    this.name = 'WikiNotFoundError';
  }
}

export interface WikiScanQuery {
  repoName: string;
  pathSegments: string[];
  keywords: string[];
}

/**
 * A wiki hosting provider (MVP implementation: Azure DevOps Wiki). Update
 * semantics are optimistic-locked via ETag (design D4); implementations MUST
 * throw {@link WikiConflictError} rather than silently overwriting.
 */
export interface WikiBackend {
  readonly name: string;

  /** Fuzzy match by repo name, path segments, and keywords for `docwelder init`'s wiki scan. */
  listPages(query: WikiScanQuery): Promise<WikiPageSummary[]>;

  getPage(path: string): Promise<WikiPage>;

  /** Creates at a nested path, relying on the backend to auto-create intermediate segments. */
  createPage(path: string, content: string): Promise<{ etag: string }>;

  /** Throws {@link WikiConflictError} when `ifMatchEtag` does not match the page's current ETag. */
  updatePage(path: string, content: string, ifMatchEtag: string): Promise<{ etag: string }>;
}
