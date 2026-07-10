export interface GitDiffResult {
  raw: string;
  baseSha: string;
  headSha: string;
}

export interface CommitAuthor {
  name: string;
  email: string;
}

export interface CommitInfo {
  sha: string;
  author: CommitAuthor;
  message: string;
}

/** `content: null` deletes the file at `path`. */
export interface FileChange {
  path: string;
  content: string | null;
}

export interface CommitAndPushInput {
  branch: string;
  message: string;
  changes: FileChange[];
}

export interface CommitAndPushResult {
  /** True when `changes` produced no diff against HEAD; no commit was created. */
  skipped: boolean;
  sha: string | null;
}

export interface OpenIssueInput {
  title: string;
  description: string;
}

export interface OpenIssueResult {
  iid: number;
  url: string;
}

/**
 * A git hosting provider (MVP implementation: GitLab). Every implementation
 * MUST append `[skip ci]` to every commit message produced by
 * {@link GitHost.commitAndPush} (design D9) so bot commits never
 * re-trigger the pipeline.
 */
export interface GitHost {
  readonly name: string;

  /** Local `git diff` between two refs; MVP never calls a remote diff API (design D3). */
  diff(baseRef: string, headRef: string): Promise<GitDiffResult>;

  /** Commits authored strictly after `fromRef` up to and including `toRef`, oldest first. */
  listCommitsInRange(fromRef: string, toRef: string): Promise<CommitInfo[]>;

  /** No-ops (returns `{ skipped: true, sha: null }`) when `changes` is empty or a no-op diff. */
  commitAndPush(input: CommitAndPushInput): Promise<CommitAndPushResult>;

  commentOnMergeRequest(mergeRequestIid: number, body: string): Promise<void>;

  openIssue(input: OpenIssueInput): Promise<OpenIssueResult>;
}
