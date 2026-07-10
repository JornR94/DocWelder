import { createHash } from 'node:crypto';
import { z } from 'zod';
import { WIKI_STAGING_DIR } from './manifest.js';

/**
 * `.docs/wiki-staging/.docwelder-state.json` — the idempotency marker from
 * design D8: per-artifact SHA-256 of the bot's last-known-good output. Read
 * from the checkout at job start and rewritten in the same commit that
 * writes README/CHANGELOG/staging artifacts (design D11: state lives only in
 * git). The recursion guard (task 10.10) is deliberately NOT tracked here —
 * it's fully derivable from commit authorship via `GitHost.listCommitsInRange`
 * (git history is itself the durable store; no separate pointer needed).
 */
export const StateSchema = z.object({
  artifacts: z
    .object({
      readme: z.string().nullable().default(null),
      changelogEntry: z.string().nullable().default(null),
      wikiPages: z.record(z.string(), z.string()).default({}),
    })
    .default({}),
});

export type DocwelderState = z.infer<typeof StateSchema>;

export const STATE_PATH = `${WIKI_STAGING_DIR}/.docwelder-state.json`;

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function defaultState(): DocwelderState {
  return StateSchema.parse({});
}

export function parseState(raw: string): DocwelderState {
  return StateSchema.parse(JSON.parse(raw));
}

export function serializeState(state: DocwelderState): string {
  return JSON.stringify(state, null, 2) + '\n';
}
