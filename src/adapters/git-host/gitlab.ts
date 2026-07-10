import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  CommitAndPushInput,
  CommitAndPushResult,
  CommitInfo,
  GitDiffResult,
  GitHost,
  OpenIssueInput,
  OpenIssueResult,
} from './interface.js';

type ExecFileFn = typeof execFileCb;

const SKIP_CI_TRAILER = '[skip ci]';
// Unit/record separators: unambiguous even if commit subjects contain arbitrary punctuation.
const COMMIT_FIELD_SEP = String.fromCharCode(31);
const COMMIT_RECORD_SEP = String.fromCharCode(30);

export interface GitlabHostConfig {
  token: string;
  serverHost: string;
  projectId: string;
  projectPath: string;
  apiBaseUrl?: string;
  mergeRequestIid?: string;
  /** Repository working tree root; defaults to `process.cwd()` (the CI job's checkout in production). */
  cwd?: string;
  execFileImpl?: ExecFileFn;
  fetchImpl?: typeof fetch;
}

/**
 * `GitHost` implementation backed by GitLab: local `git` for diff/commit/push
 * (design D3), the GitLab REST API for MR comments and issues.
 */
export class GitlabHost implements GitHost {
  readonly name = 'gitlab';

  private readonly token: string;
  private readonly serverHost: string;
  private readonly projectId: string;
  private readonly projectPath: string;
  private readonly apiBaseUrl: string;
  private readonly cwd: string;
  private readonly execFile: (
    file: string,
    args: string[],
    options?: { maxBuffer?: number; cwd?: string },
  ) => Promise<{ stdout: string; stderr: string }>;
  private readonly fetchImpl: typeof fetch;

  constructor(config: GitlabHostConfig) {
    this.token = config.token;
    this.serverHost = config.serverHost;
    this.projectId = config.projectId;
    this.projectPath = config.projectPath;
    this.apiBaseUrl = config.apiBaseUrl ?? `https://${config.serverHost}/api/v4`;
    this.cwd = config.cwd ?? process.cwd();
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.execFile = promisify(config.execFileImpl ?? execFileCb);
  }

  async diff(baseRef: string, headRef: string): Promise<GitDiffResult> {
    try {
      const { stdout } = await this.execFile('git', ['diff', `${baseRef}...${headRef}`], {
        maxBuffer: 50 * 1024 * 1024,
        cwd: this.cwd,
      });
      return { raw: stdout, baseSha: baseRef, headSha: headRef };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Unable to compute git diff between "${baseRef}" and "${headRef}": ${detail}. ` +
          `The base ref is likely unreachable in this checkout — confirm the CI template sets ` +
          `GIT_DEPTH: "0" on the docwelder-propose job (design D3).`,
      );
    }
  }

  async listCommitsInRange(fromRef: string, toRef: string): Promise<CommitInfo[]> {
    const format = ['%H', '%an', '%ae', '%s'].join(COMMIT_FIELD_SEP) + COMMIT_RECORD_SEP;
    let stdout: string;
    try {
      const result = await this.execFile(
        'git',
        ['log', '--reverse', `--format=${format}`, `${fromRef}..${toRef}`],
        { maxBuffer: 50 * 1024 * 1024, cwd: this.cwd },
      );
      stdout = result.stdout;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Unable to list commits between "${fromRef}" and "${toRef}": ${detail}`);
    }

    return stdout
      .split(COMMIT_RECORD_SEP)
      .map((record) => record.trim())
      .filter((record) => record.length > 0)
      .map((record) => {
        const [sha, name, email, message] = record.split(COMMIT_FIELD_SEP);
        return {
          sha: sha ?? '',
          author: { name: name ?? '', email: email ?? '' },
          message: message ?? '',
        };
      });
  }

  async commitAndPush(input: CommitAndPushInput): Promise<CommitAndPushResult> {
    for (const change of input.changes) {
      const absolutePath = join(this.cwd, change.path);
      if (change.content === null) {
        await rm(absolutePath, { force: true, recursive: true });
      } else {
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, change.content, 'utf8');
      }
    }

    await this.execFile('git', ['add', '-A'], { cwd: this.cwd });

    const { stdout: statusOut } = await this.execFile('git', ['status', '--porcelain'], {
      cwd: this.cwd,
    });
    if (statusOut.trim().length === 0) {
      return { skipped: true, sha: null };
    }

    const message = input.message.includes(SKIP_CI_TRAILER)
      ? input.message
      : `${input.message}\n\n${SKIP_CI_TRAILER}`;

    await this.execFile(
      'git',
      [
        '-c',
        'user.name=Docwelder Bot',
        '-c',
        'user.email=docwelder-bot@users.noreply.local',
        'commit',
        '-m',
        message,
      ],
      { cwd: this.cwd },
    );

    const remoteUrl = `https://oauth2:${this.token}@${this.serverHost}/${this.projectPath}.git`;
    await this.execFile('git', ['push', remoteUrl, `HEAD:${input.branch}`], {
      cwd: this.cwd,
    });

    const { stdout: shaOut } = await this.execFile('git', ['rev-parse', 'HEAD'], {
      cwd: this.cwd,
    });

    return { skipped: false, sha: shaOut.trim() };
  }

  async commentOnMergeRequest(mergeRequestIid: number, body: string): Promise<void> {
    const url = `${this.apiBaseUrl}/projects/${encodeURIComponent(this.projectId)}/merge_requests/${mergeRequestIid}/notes`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to post comment on merge request !${mergeRequestIid}: ${response.status} ${await safeText(response)}`,
      );
    }
  }

  async openIssue(input: OpenIssueInput): Promise<OpenIssueResult> {
    const url = `${this.apiBaseUrl}/projects/${encodeURIComponent(this.projectId)}/issues`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: input.title, description: input.description }),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to open issue "${input.title}": ${response.status} ${await safeText(response)}`,
      );
    }
    const json = (await response.json()) as { iid: number; web_url: string };
    return { iid: json.iid, url: json.web_url };
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
