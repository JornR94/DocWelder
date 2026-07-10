import { describe, expect, it } from 'vitest';
import { TokenBudgetTracker } from '../../../../src/adapters/llm-provider/budget.js';

describe('TokenBudgetTracker', () => {
  it('accumulates usage across multiple record() calls', () => {
    const tracker = new TokenBudgetTracker(100);
    tracker.record({ promptTokens: 10, completionTokens: 10, totalTokens: 20 });
    tracker.record({ promptTokens: 15, completionTokens: 15, totalTokens: 30 });
    expect(tracker.remaining()).toBe(50);
    expect(tracker.exceeded()).toBe(false);
  });

  it('flips exceeded() to true once remaining() would go negative', () => {
    const tracker = new TokenBudgetTracker(20);
    tracker.record({ promptTokens: 10, completionTokens: 10, totalTokens: 25 });
    expect(tracker.remaining()).toBe(-5);
    expect(tracker.exceeded()).toBe(true);
  });

  it('is not exceeded when usage exactly matches the budget', () => {
    const tracker = new TokenBudgetTracker(20);
    tracker.record({ promptTokens: 10, completionTokens: 10, totalTokens: 20 });
    expect(tracker.remaining()).toBe(0);
    expect(tracker.exceeded()).toBe(false);
  });
});
