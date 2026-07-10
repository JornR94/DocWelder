import { describe, expect, it } from 'vitest';
import { appendChangelogEntry } from '../../../src/pipeline/changelog-entry.js';

describe('appendChangelogEntry', () => {
  it('creates Unreleased + category headings from an empty file', () => {
    const result = appendChangelogEntry('', { category: 'Added', description: 'New thing' });
    expect(result).toContain('## [Unreleased]');
    expect(result).toContain('### Added');
    expect(result).toContain('- New thing');
  });

  it('creates a category heading under an existing Unreleased section', () => {
    const existing =
      '# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Old fix\n\n## [1.0.0]\n\n- Initial release\n';
    const result = appendChangelogEntry(existing, { category: 'Added', description: 'New thing' });
    expect(result).toContain('### Added');
    expect(result).toContain('- New thing');
    expect(result).toContain('- Old fix');
    expect(result).toContain('## [1.0.0]');
    // new entry must land inside Unreleased, before the 1.0.0 section
    expect(result.indexOf('- New thing')).toBeLessThan(result.indexOf('## [1.0.0]'));
  });

  it('appends a bullet under an existing matching category', () => {
    const existing =
      '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- First\n\n## [1.0.0]\n\n- Initial\n';
    const result = appendChangelogEntry(existing, { category: 'Added', description: 'Second' });
    expect(result).toContain('- First');
    expect(result).toContain('- Second');
    expect(result.indexOf('- First')).toBeLessThan(result.indexOf('- Second'));
  });

  it('preserves unrelated content untouched', () => {
    const existing =
      '# Changelog\n\nSome preamble text.\n\n## [Unreleased]\n\n## [1.0.0]\n\n- Initial\n';
    const result = appendChangelogEntry(existing, { category: 'Fixed', description: 'Bug fix' });
    expect(result).toContain('Some preamble text.');
    expect(result).toContain('- Initial');
  });
});
