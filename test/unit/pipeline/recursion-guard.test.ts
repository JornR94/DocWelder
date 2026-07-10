import { describe, expect, it, vi } from 'vitest';
import { shouldShortCircuit } from '../../../src/pipeline/recursion-guard.js';
import type { GitHost } from '../../../src/adapters/git-host/interface.js';

function fakeGitHost(commits: { name: string }[]): GitHost {
  return {
    name: 'fake',
    diff: vi.fn(),
    listCommitsInRange: vi.fn().mockResolvedValue(
      commits.map((c, i) => ({
        sha: `sha${i}`,
        author: { name: c.name, email: 'x@x' },
        message: 'm',
      })),
    ),
    commitAndPush: vi.fn(),
    commentOnMergeRequest: vi.fn(),
    openIssue: vi.fn(),
  };
}

describe('shouldShortCircuit', () => {
  it('returns false when the commit range is empty', async () => {
    const gitHost = fakeGitHost([]);
    expect(await shouldShortCircuit(gitHost, 'base', 'Docwelder Bot')).toBe(false);
  });

  it('returns true when every commit is bot-authored', async () => {
    const gitHost = fakeGitHost([{ name: 'Docwelder Bot' }, { name: 'Docwelder Bot' }]);
    expect(await shouldShortCircuit(gitHost, 'base', 'Docwelder Bot')).toBe(true);
  });

  it('returns false when any commit is non-bot-authored', async () => {
    const gitHost = fakeGitHost([{ name: 'Docwelder Bot' }, { name: 'A Human' }]);
    expect(await shouldShortCircuit(gitHost, 'base', 'Docwelder Bot')).toBe(false);
  });
});
