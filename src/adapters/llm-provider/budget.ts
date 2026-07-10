import type { TokenUsage } from './interface.js';

/**
 * Per-MR token budget accounting (task 5.4 / design D7 risk mitigation).
 * `docwelder propose` fails non-blockingly once the budget is exhausted
 * rather than issuing further LLM calls.
 */
export class TokenBudgetTracker {
  private spent = 0;

  constructor(private readonly maxTotalTokens: number) {}

  record(usage: TokenUsage): void {
    this.spent += usage.totalTokens;
  }

  remaining(): number {
    return this.maxTotalTokens - this.spent;
  }

  exceeded(): boolean {
    return this.remaining() < 0;
  }
}
