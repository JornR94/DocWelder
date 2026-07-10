import type { execFile as ExecFileType } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitlabHost } from '../../../../src/adapters/git-host/gitlab.js';

interface Call {
  file: string;
  args: string[];
  options?: { maxBuffer?: number; cwd?: string };
}

/** Builds a fake `execFile` (Node callback style) driven by a queue of canned responses. */
function fakeExecFile(responses: Array<{ stdout?: string; stderr?: string; error?: Error }>): {
  impl: (...args: unknown[]) => void;
  calls: Call[];
} {
  const calls: Call[] = [];
  let i = 0;
  const impl = (
    file: string,
    args: string[],
    options: { maxBuffer?: number; cwd?: string } | undefined,
    callback: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
    calls.push({ file, args, options });
    const response = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (response?.error) {
      callback(response.error);
      return;
    }
    callback(null, { stdout: response?.stdout ?? '', stderr: response?.stderr ?? '' });
  };
  return { impl: impl as unknown as (...args: unknown[]) => void, calls };
}

function makeHost(
  execFileImpl: ReturnType<typeof fakeExecFile>['impl'],
  fetchImpl?: typeof fetch,
  cwd?: string,
): GitlabHost {
  return new GitlabHost({
    token: 'bot-token-123',
    serverHost: 'gitlab.example.com',
    projectId: '42',
    projectPath: 'group/subgroup/repo',
    cwd,
    execFileImpl: execFileImpl as unknown as typeof ExecFileType,
    fetchImpl,
  });
}

describe('GitlabHost.diff', () => {
  it('returns the raw diff text on success', async () => {
    const { impl, calls } = fakeExecFile([{ stdout: 'diff --git a/x b/x\n+hi\n' }]);
    const host = makeHost(impl);
    const result = await host.diff('base-sha', 'HEAD');
    expect(result).toEqual({
      raw: 'diff --git a/x b/x\n+hi\n',
      baseSha: 'base-sha',
      headSha: 'HEAD',
    });
    expect(calls[0]!.args).toEqual(['diff', 'base-sha...HEAD']);
  });

  it('throws a descriptive error naming the unreachable ref when git diff fails', async () => {
    const { impl } = fakeExecFile([{ error: new Error('fatal: bad revision') }]);
    const host = makeHost(impl);
    await expect(host.diff('missing-sha', 'HEAD')).rejects.toThrow(/missing-sha/);
    await expect(host.diff('missing-sha', 'HEAD')).rejects.toThrow(/GIT_DEPTH/);
  });
});

describe('GitlabHost.listCommitsInRange', () => {
  it('parses multiple commits with author name, email, and message, oldest first', async () => {
    const sep = String.fromCharCode(31);
    const rec = String.fromCharCode(30);
    const stdout =
      [
        ['sha1', 'Alice', 'alice@example.com', 'first commit'].join(sep),
        ['sha2', 'Docwelder Bot', 'docwelder-bot@users.noreply.local', 'chore: docs'].join(sep),
      ].join(rec) + rec;
    const { impl, calls } = fakeExecFile([{ stdout }]);
    const host = makeHost(impl);
    const commits = await host.listCommitsInRange('from-sha', 'to-sha');
    expect(commits).toEqual([
      {
        sha: 'sha1',
        author: { name: 'Alice', email: 'alice@example.com' },
        message: 'first commit',
      },
      {
        sha: 'sha2',
        author: { name: 'Docwelder Bot', email: 'docwelder-bot@users.noreply.local' },
        message: 'chore: docs',
      },
    ]);
    expect(calls[0]!.args).toContain('--reverse');
    expect(calls[0]!.args[calls[0]!.args.length - 1]).toBe('from-sha..to-sha');
  });
});

describe('GitlabHost.commitAndPush', () => {
  // `commitAndPush` writes real files under `cwd` (only the git plumbing is
  // faked) — every test here MUST pass an isolated temp directory, never the
  // real process cwd, or it will write into this project's own working tree.
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'docwelder-gitlab-test-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('skips committing when nothing is staged', async () => {
    const { impl, calls } = fakeExecFile([
      { stdout: '' }, // git add -A
      { stdout: '' }, // git status --porcelain (empty => nothing staged)
    ]);
    const host = makeHost(impl, undefined, cwd);
    const result = await host.commitAndPush({
      branch: 'feature',
      message: 'docs: update',
      changes: [],
    });
    expect(result).toEqual({ skipped: true, sha: null });
    expect(calls.some((c) => c.args.includes('commit'))).toBe(false);
    expect(calls.some((c) => c.args[0] === 'push')).toBe(false);
  });
});

describe('GitlabHost.commitAndPush (with staged changes)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'docwelder-gitlab-test-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('appends [skip ci] to the commit message and pushes with the token embedded in the URL', async () => {
    const { impl, calls } = fakeExecFile([
      { stdout: '' }, // add -A
      { stdout: ' M README.md\n' }, // status --porcelain (non-empty => staged)
      { stdout: '' }, // commit
      { stdout: '' }, // push
      { stdout: 'abc123deadbeef\n' }, // rev-parse HEAD
    ]);
    const host = makeHost(impl, undefined, cwd);
    const result = await host.commitAndPush({
      branch: 'feature/docs',
      message: 'docs: sync readme',
      changes: [{ path: 'README.md', content: '# hi' }],
    });

    expect(result).toEqual({ skipped: false, sha: 'abc123deadbeef' });

    const commitCall = calls.find((c) => c.args.includes('commit'));
    expect(commitCall).toBeDefined();
    const messageArgIndex = commitCall!.args.indexOf('-m') + 1;
    expect(commitCall!.args[messageArgIndex]).toContain('[skip ci]');
    expect(commitCall!.args[messageArgIndex]).toContain('docs: sync readme');

    const pushCall = calls.find((c) => c.args[0] === 'push');
    expect(pushCall).toBeDefined();
    expect(pushCall!.args[1]).toContain(
      'oauth2:bot-token-123@gitlab.example.com/group/subgroup/repo.git',
    );
    expect(pushCall!.args[2]).toBe('HEAD:feature/docs');
  });

  it('does not duplicate the [skip ci] trailer if the caller already included it', async () => {
    const { impl, calls } = fakeExecFile([
      { stdout: '' },
      { stdout: ' M README.md\n' },
      { stdout: '' },
      { stdout: '' },
      { stdout: 'sha\n' },
    ]);
    const host = makeHost(impl, undefined, cwd);
    await host.commitAndPush({
      branch: 'feature',
      message: 'docs: update\n\n[skip ci]',
      changes: [{ path: 'README.md', content: 'x' }],
    });
    const commitCall = calls.find((c) => c.args.includes('commit'));
    const messageArgIndex = commitCall!.args.indexOf('-m') + 1;
    const occurrences = commitCall!.args[messageArgIndex]!.split('[skip ci]').length - 1;
    expect(occurrences).toBe(1);
  });
});

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('GitlabHost.commentOnMergeRequest', () => {
  it('posts to the notes endpoint with the PRIVATE-TOKEN header and JSON body', async () => {
    const { impl } = fakeExecFile([]);
    const fetchMock = fakeFetch(201, {});
    const host = makeHost(impl, fetchMock);
    await host.commentOnMergeRequest(7, 'Docwelder proposes changes.');

    const call = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe('https://gitlab.example.com/api/v4/projects/42/merge_requests/7/notes');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('bot-token-123');
    expect(JSON.parse(init.body as string)).toEqual({ body: 'Docwelder proposes changes.' });
  });

  it('throws when the API responds with a non-2xx status', async () => {
    const { impl } = fakeExecFile([]);
    const fetchMock = fakeFetch(500, { message: 'boom' });
    const host = makeHost(impl, fetchMock);
    await expect(host.commentOnMergeRequest(7, 'x')).rejects.toThrow(/500/);
  });
});

describe('GitlabHost.openIssue', () => {
  it('posts to the issues endpoint and returns iid + url', async () => {
    const { impl } = fakeExecFile([]);
    const fetchMock = fakeFetch(201, {
      iid: 9,
      web_url: 'https://gitlab.example.com/g/r/-/issues/9',
    });
    const host = makeHost(impl, fetchMock);
    const result = await host.openIssue({ title: 'Wiki publish failed', description: 'details' });

    expect(result).toEqual({ iid: 9, url: 'https://gitlab.example.com/g/r/-/issues/9' });
    const call = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe('https://gitlab.example.com/api/v4/projects/42/issues');
    expect((init.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('bot-token-123');
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Wiki publish failed',
      description: 'details',
    });
  });

  it('throws when the API responds with a non-2xx status', async () => {
    const { impl } = fakeExecFile([]);
    const fetchMock = fakeFetch(403, {});
    const host = makeHost(impl, fetchMock);
    await expect(host.openIssue({ title: 't', description: 'd' })).rejects.toThrow(/403/);
  });
});
