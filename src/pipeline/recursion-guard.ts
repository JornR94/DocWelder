import type { GitHost } from '../adapters/git-host/interface.js';

/**
 * Recursion guard (task 10.10): belt-and-braces on top of `[skip ci]` (design D9).
 * Short-circuits when every commit since `baseRef` was authored by the bot —
 * i.e. nothing genuinely new for a human to react to since the last regeneration.
 * An empty commit range is NOT a short-circuit (that's the separate no-op-diff path).
 */
export async function shouldShortCircuit(
  gitHost: GitHost,
  baseRef: string,
  botAuthorName: string,
): Promise<boolean> {
  const commits = await gitHost.listCommitsInRange(baseRef, 'HEAD');
  return commits.length > 0 && commits.every((commit) => commit.author.name === botAuthorName);
}
