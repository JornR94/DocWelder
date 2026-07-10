import { describe, expect, it } from 'vitest';
import { defaultState, parseState, serializeState, sha256 } from '../../../src/pipeline/state.js';

describe('state', () => {
  it('produces a stable default state', () => {
    const state = defaultState();
    expect(state).toEqual({
      artifacts: { readme: null, changelogEntry: null, wikiPages: {} },
    });
  });

  it('round-trips through serializeState/parseState', () => {
    const state = {
      artifacts: {
        readme: sha256('# Hello'),
        changelogEntry: null,
        wikiPages: { '/API/Overview': sha256('content') },
      },
    };
    const roundTripped = parseState(serializeState(state));
    expect(roundTripped).toEqual(state);
  });

  it('sha256 is deterministic and content-sensitive', () => {
    expect(sha256('a')).toBe(sha256('a'));
    expect(sha256('a')).not.toBe(sha256('b'));
  });
});
