import { describe, expect, it } from 'vitest';
import { ConfigValidationError } from '../../../src/config/errors.js';
import { findMappingForPath, parseMapping } from '../../../src/config/mapping.js';

describe('parseMapping', () => {
  it('parses a valid mapping file', () => {
    const raw = `
mappings:
  - code_path: "src/api/**"
    wiki_path: "/API/Overview"
  - code_path: "src/cli/**"
    wiki_path: "/CLI/Reference"
`;
    const mapping = parseMapping(raw);
    expect(mapping.mappings).toHaveLength(2);
    expect(findMappingForPath(mapping, 'src/api/routes.ts')?.wiki_path).toBe('/API/Overview');
    expect(findMappingForPath(mapping, 'src/other/file.ts')).toBeUndefined();
  });

  it('defaults to an empty mapping list when the file has no mappings key', () => {
    const mapping = parseMapping('{}');
    expect(mapping.mappings).toEqual([]);
  });

  it('throws ConfigValidationError on an invalid glob pattern', () => {
    const raw = `
mappings:
  - code_path: "src/[unterminated"
    wiki_path: "/A"
`;
    try {
      parseMapping(raw, '.docs/mapping.yaml');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const validationError = err as ConfigValidationError;
      expect(validationError.details[0]?.field).toBe('mappings[0].code_path');
    }
  });

  it('throws ConfigValidationError on a duplicate code_path', () => {
    const raw = `
mappings:
  - code_path: "src/api/**"
    wiki_path: "/API/Overview"
  - code_path: "src/api/**"
    wiki_path: "/API/Other"
`;
    try {
      parseMapping(raw, '.docs/mapping.yaml');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const validationError = err as ConfigValidationError;
      expect(validationError.details.some((d) => d.message.includes('duplicate'))).toBe(true);
    }
  });
});
