import { describe, expect, it } from 'vitest';
import { parseManifest, serializeManifest } from '../../../src/pipeline/manifest.js';

describe('manifest', () => {
  it('parses update and create entries', () => {
    const raw = `
entries:
  - wiki_path: /API/Overview
    operation: update
    local_file: pages/api-overview.md
    source_etag: "abc123"
  - wiki_path: /New/Page
    operation: create
    local_file: pages/new-page.md
`;
    const manifest = parseManifest(raw);
    expect(manifest.entries).toHaveLength(2);
    expect(manifest.entries[0]?.source_etag).toBe('abc123');
    expect(manifest.entries[1]?.source_etag).toBeUndefined();
  });

  it('rejects an update entry missing source_etag', () => {
    const raw = `
entries:
  - wiki_path: /API/Overview
    operation: update
    local_file: pages/api-overview.md
`;
    expect(() => parseManifest(raw)).toThrow();
  });

  it('rejects a create entry that includes source_etag', () => {
    const raw = `
entries:
  - wiki_path: /New/Page
    operation: create
    local_file: pages/new-page.md
    source_etag: "should-not-be-here"
`;
    expect(() => parseManifest(raw)).toThrow();
  });

  it('round-trips through serializeManifest', () => {
    const manifest = parseManifest(`
entries:
  - wiki_path: /A
    operation: create
    local_file: pages/a.md
`);
    const roundTripped = parseManifest(serializeManifest(manifest));
    expect(roundTripped).toEqual(manifest);
  });

  it('defaults to an empty entries list', () => {
    expect(parseManifest('{}').entries).toEqual([]);
  });
});
