import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  categorizeCommitSubject,
  generateChangelogFromHistory,
} from '../../../src/pipeline/changelog-history.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

describe('categorizeCommitSubject', () => {
  it('maps conventional-commit prefixes to Keep a Changelog categories', () => {
    expect(categorizeCommitSubject('feat: add widget')).toBe('Added');
    expect(categorizeCommitSubject('fix: crash on startup')).toBe('Fixed');
    expect(categorizeCommitSubject('chore: bump deps')).toBe('Changed');
    expect(categorizeCommitSubject('remove: dead code')).toBe('Removed');
    expect(categorizeCommitSubject('security: patch CVE')).toBe('Security');
    expect(categorizeCommitSubject('bump version to 2.0')).toBe('Changed');
  });
});

describe('generateChangelogFromHistory', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'docwelder-changelog-'));
    git(repoRoot, ['init', '-q']);
    git(repoRoot, ['config', 'user.email', 'test@example.com']);
    git(repoRoot, ['config', 'user.name', 'Test']);
    writeFileSync(join(repoRoot, 'a.txt'), 'a');
    git(repoRoot, ['add', '.']);
    git(repoRoot, ['commit', '-q', '-m', 'feat: initial feature']);
    writeFileSync(join(repoRoot, 'b.txt'), 'b');
    git(repoRoot, ['add', '.']);
    git(repoRoot, ['commit', '-q', '-m', 'fix: a bug']);
    writeFileSync(join(repoRoot, 'c.txt'), 'c');
    git(repoRoot, ['add', '.']);
    git(repoRoot, ['commit', '-q', '-m', 'refactor internal thing']);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('buckets commits into Keep a Changelog categories under Unreleased', () => {
    const changelog = generateChangelogFromHistory(repoRoot);
    expect(changelog).toContain('# Changelog');
    expect(changelog).toContain('## [Unreleased]');
    expect(changelog).toContain('### Added');
    expect(changelog).toContain('- feat: initial feature');
    expect(changelog).toContain('### Fixed');
    expect(changelog).toContain('- fix: a bug');
    expect(changelog).toContain('### Changed');
    expect(changelog).toContain('- refactor internal thing');
  });

  it('omits category headers with no entries', () => {
    const changelog = generateChangelogFromHistory(repoRoot);
    expect(changelog).not.toContain('### Security');
    expect(changelog).not.toContain('### Deprecated');
  });
});
