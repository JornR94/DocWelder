import { describe, expect, it } from 'vitest';
import { appendValidationRetry } from '../../../../src/adapters/llm-provider/retry.js';
import type { ChatMessage } from '../../../../src/adapters/llm-provider/interface.js';

describe('appendValidationRetry', () => {
  it('appends an assistant message with the prior draft and a user message listing errors', () => {
    const messages: ChatMessage[] = [{ role: 'system', content: 'You are a doc bot.' }];
    const priorDraft = { readme: { content: '# Old' } };
    const errors = ['README missing required section "Installation"', 'Heading depth exceeds 4'];

    const result = appendValidationRetry(messages, priorDraft, errors);

    expect(result).toHaveLength(messages.length + 2);
    expect(result[0]).toEqual(messages[0]);
    expect(result[1]?.role).toBe('assistant');
    expect(result[1]?.content).toContain(JSON.stringify(priorDraft));
    expect(result[2]?.role).toBe('user');
    expect(result[2]?.content).toContain(errors[0]);
    expect(result[2]?.content).toContain(errors[1]);
  });

  it('does not mutate the input messages array', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];
    const before = [...messages];
    appendValidationRetry(messages, {}, ['some error']);
    expect(messages).toEqual(before);
  });
});
