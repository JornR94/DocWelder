import { execFileSync } from 'node:child_process';

const CATEGORY_PREFIXES: Record<string, string> = {
  feat: 'Added',
  feature: 'Added',
  add: 'Added',
  fix: 'Fixed',
  bugfix: 'Fixed',
  chore: 'Changed',
  refactor: 'Changed',
  docs: 'Changed',
  perf: 'Changed',
  style: 'Changed',
  test: 'Changed',
  remove: 'Removed',
  revert: 'Removed',
  security: 'Security',
  deprecate: 'Deprecated',
};

const CATEGORY_ORDER = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];

interface CommitSubject {
  sha: string;
  subject: string;
}

/** ASCII unit separator — never appears in a commit subject, safe delimiter for `git log --format`. */
const FIELD_SEP = String.fromCharCode(31);

function listCommits(cwd: string): CommitSubject[] {
  let raw: string;
  try {
    raw = execFileSync('git', ['log', '--reverse', `--format=%H${FIELD_SEP}%s`], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [sha, subject] = line.split(FIELD_SEP);
      return { sha: sha ?? '', subject: subject ?? '' };
    });
}

/** Best-effort Conventional-Commits-style prefix detection; unrecognized subjects bucket under "Changed". */
export function categorizeCommitSubject(subject: string): string {
  const match = /^([a-zA-Z]+)(\([^)]*\))?!?:\s*/.exec(subject);
  if (match) {
    const category = CATEGORY_PREFIXES[match[1]!.toLowerCase()];
    if (category) return category;
  }
  return 'Changed';
}

/**
 * Deterministic `CHANGELOG.md` seed from git history (spec `repo-init`:
 * "Missing CHANGELOG is generated from git history"). Every commit lands in
 * a single `## [Unreleased]` section, bucketed by Keep a Changelog category.
 */
export function generateChangelogFromHistory(cwd: string): string {
  const commits = listCommits(cwd);
  const buckets = new Map<string, string[]>();
  for (const commit of commits) {
    const category = categorizeCommitSubject(commit.subject);
    const list = buckets.get(category) ?? [];
    list.push(commit.subject);
    buckets.set(category, list);
  }

  const lines: string[] = [
    '# Changelog',
    '',
    'All notable changes to this project will be documented in this file.',
    '',
    'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).',
    '',
    '## [Unreleased]',
    '',
  ];
  for (const category of CATEGORY_ORDER) {
    const entries = buckets.get(category);
    if (!entries || entries.length === 0) continue;
    lines.push(`### ${category}`, '');
    for (const entry of entries) {
      lines.push(`- ${entry}`);
    }
    lines.push('');
  }
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}
