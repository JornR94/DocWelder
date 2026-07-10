import { describe, expect, it } from 'vitest';
import { ProposalSchema } from '../../../../src/adapters/llm-provider/propose-contract.js';

describe('ProposalSchema', () => {
  it('accepts a fully-populated proposal', () => {
    const result = ProposalSchema.safeParse({
      readme: { content: '# Hello' },
      changelog: { category: 'Added', description: 'New feature' },
      wikiPages: [{ path: '/Architecture', operation: 'update', content: 'body' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an all-null/empty proposal (no-op outcome)', () => {
    const result = ProposalSchema.safeParse({
      readme: null,
      changelog: null,
      wikiPages: [],
    });
    expect(result.success).toBe(true);
  });

  it('defaults wikiPages to an empty array when omitted', () => {
    const result = ProposalSchema.parse({ readme: null, changelog: null });
    expect(result.wikiPages).toEqual([]);
  });

  it('rejects an invalid changelog category', () => {
    const result = ProposalSchema.safeParse({
      readme: null,
      changelog: { category: 'NotACategory', description: 'x' },
      wikiPages: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a wiki page entry missing its operation', () => {
    const result = ProposalSchema.safeParse({
      readme: null,
      changelog: null,
      wikiPages: [{ path: '/A', content: 'body' }],
    });
    expect(result.success).toBe(false);
  });
});
