import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDocStyleConfig } from '../../../src/config/doc-style-config.js';
import {
  validateChangelogEntry,
  validateReadme,
  validateWikiPage,
} from '../../../src/validators/structural.js';

const CONFIG = parseDocStyleConfig(`
wiki_backend:
  organization: contoso
  project: docs
  wiki_identifier: team-wiki
`);

describe('validateReadme', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'docwelder-structural-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('passes a README containing all required sections within limits', () => {
    const readme = `# My Project\n\n## Installation\n\nRun \`npm install\`.\n\n## Usage\n\nRun \`npm start\`.\n`;
    expect(validateReadme(readme, CONFIG.structural_rules, repoRoot)).toEqual([]);
  });

  it('flags a missing required section', () => {
    const readme = `# My Project\n\n## Usage\n\nRun it.\n`;
    const errors = validateReadme(readme, CONFIG.structural_rules, repoRoot);
    expect(errors.some((e) => e.includes('Installation'))).toBe(true);
  });

  it('flags a heading deeper than the depth limit', () => {
    const readme = `# A\n\n## Installation\n\ntext\n\n## Usage\n\ntext\n\n###### Too Deep\n\nx\n`;
    const errors = validateReadme(readme, CONFIG.structural_rules, repoRoot);
    expect(errors.some((e) => e.includes('depth'))).toBe(true);
  });

  it('flags a section exceeding the max word count', () => {
    const longBody = Array.from({ length: 500 }, () => 'word').join(' ');
    const readme = `# A\n\n## Installation\n\n${longBody}\n\n## Usage\n\ntext\n`;
    const errors = validateReadme(readme, CONFIG.structural_rules, repoRoot);
    expect(errors.some((e) => e.includes('word'))).toBe(true);
  });

  it('flags a code block whose language is not in a non-empty whitelist', () => {
    const restricted = parseDocStyleConfig(`
structural_rules:
  code_block_language_whitelist: [typescript]
wiki_backend:
  organization: contoso
  project: docs
  wiki_identifier: team-wiki
`).structural_rules;
    const readme = `# A\n\n## Installation\n\n\`\`\`bash\necho hi\n\`\`\`\n\n## Usage\n\ntext\n`;
    const errors = validateReadme(readme, restricted, repoRoot);
    expect(errors.some((e) => e.includes('bash'))).toBe(true);
  });

  it('flags a referenced path that does not exist on disk', () => {
    const readme = `# A\n\n## Installation\n\nSee [docs](./MISSING.md).\n\n## Usage\n\ntext\n`;
    const errors = validateReadme(readme, CONFIG.structural_rules, repoRoot);
    expect(errors.some((e) => e.includes('MISSING.md'))).toBe(true);
  });

  it('does not flag a referenced path that exists on disk', () => {
    writeFileSync(join(repoRoot, 'GUIDE.md'), '# Guide\n');
    const readme = `# A\n\n## Installation\n\nSee [guide](./GUIDE.md).\n\n## Usage\n\ntext\n`;
    const errors = validateReadme(readme, CONFIG.structural_rules, repoRoot);
    expect(errors.some((e) => e.includes('GUIDE.md'))).toBe(false);
  });

  it('flags a documented CLI flag absent from the codebase', () => {
    const readme = `# A\n\n## Installation\n\nRun with \`--totally-made-up-flag\`.\n\n## Usage\n\ntext\n`;
    const errors = validateReadme(readme, CONFIG.structural_rules, repoRoot);
    expect(errors.some((e) => e.includes('--totally-made-up-flag'))).toBe(true);
  });

  it('does not flag a documented CLI flag that is present in the codebase', () => {
    writeFileSync(join(repoRoot, 'cli.js'), "if (arg === '--real-flag') {}\n");
    const readme = `# A\n\n## Installation\n\nRun with \`--real-flag\`.\n\n## Usage\n\ntext\n`;
    const errors = validateReadme(readme, CONFIG.structural_rules, repoRoot);
    expect(errors.some((e) => e.includes('--real-flag'))).toBe(false);
  });
});

describe('validateChangelogEntry', () => {
  it('passes a valid Keep a Changelog entry', () => {
    expect(
      validateChangelogEntry(
        { category: 'Added', description: 'New thing' },
        CONFIG.structural_rules,
      ),
    ).toEqual([]);
  });

  it('flags an invalid category', () => {
    const errors = validateChangelogEntry(
      { category: 'Bogus', description: 'x' },
      CONFIG.structural_rules,
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('flags an empty description', () => {
    const errors = validateChangelogEntry(
      { category: 'Added', description: '   ' },
      CONFIG.structural_rules,
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('validateWikiPage', () => {
  it('flags heading depth violations the same way as README', () => {
    const page = `# A\n\n###### Too Deep\n`;
    expect(validateWikiPage(page, CONFIG.structural_rules).length).toBeGreaterThan(0);
  });

  it('passes a well-formed page', () => {
    expect(validateWikiPage('# A\n\n## B\n\ntext\n', CONFIG.structural_rules)).toEqual([]);
  });
});
