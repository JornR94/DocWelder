import { describe, expect, it, vi } from 'vitest';
import {
  LLMProviderError,
  LLMTimeoutError,
} from '../../../../src/adapters/llm-provider/interface.js';
import {
  DEFAULT_OPENROUTER_MODEL,
  OpenRouterProvider,
} from '../../../../src/adapters/llm-provider/openrouter.js';

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OpenRouterProvider', () => {
  it('completes successfully and maps content/usage/model, honoring a per-request model override', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body)) as { model: string };
      expect(requestBody.model).toBe('openai/gpt-4o-mini');
      return jsonResponse({
        model: 'openai/gpt-4o-mini',
        choices: [{ message: { content: JSON.stringify({ hello: 'world' }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    });

    const provider = new OpenRouterProvider({
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.completeStructured({
      messages: [{ role: 'user', content: 'hi' }],
      responseSchema: { type: 'object' },
      schemaName: 'test-schema',
      model: 'openai/gpt-4o-mini',
    });

    expect(result.data).toEqual({ hello: 'world' });
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(result.model).toBe('openai/gpt-4o-mini');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('falls back to the default model when no override is given', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body)) as { model: string };
      expect(requestBody.model).toBe(DEFAULT_OPENROUTER_MODEL);
      return jsonResponse({
        choices: [{ message: { content: '{}' } }],
        usage: {},
      });
    });

    const provider = new OpenRouterProvider({
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.completeStructured({
      messages: [{ role: 'user', content: 'hi' }],
      responseSchema: { type: 'object' },
      schemaName: 'test-schema',
    });

    expect(result.model).toBe(DEFAULT_OPENROUTER_MODEL);
  });

  it('throws LLMTimeoutError when the request does not resolve within timeoutMs', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const provider = new OpenRouterProvider({
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      provider.completeStructured({
        messages: [{ role: 'user', content: 'hi' }],
        responseSchema: { type: 'object' },
        schemaName: 'test-schema',
        timeoutMs: 10,
      }),
    ).rejects.toBeInstanceOf(LLMTimeoutError);
  });

  it('throws LLMProviderError on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'boom' }, { status: 500 }));

    const provider = new OpenRouterProvider({
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      provider.completeStructured({
        messages: [{ role: 'user', content: 'hi' }],
        responseSchema: { type: 'object' },
        schemaName: 'test-schema',
      }),
    ).rejects.toBeInstanceOf(LLMProviderError);
  });
});
