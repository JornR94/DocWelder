import {
  LLMProviderError,
  LLMTimeoutError,
  type LLMProvider,
  type StructuredCompletionRequest,
  type StructuredCompletionResult,
  type TokenUsage,
} from './interface.js';

export const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4-flash';

const DEFAULT_TIMEOUT_MS = 60_000;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface OpenRouterProviderOptions {
  apiKey: string;
  defaultModel?: string;
  fetchImpl?: typeof fetch;
}

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface OpenRouterResponseBody {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: OpenRouterUsage;
  model?: string;
}

/** MVP `LLMProvider` implementation: a single credential fronting many models via OpenRouter. */
export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter';

  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenRouterProviderOptions) {
    this.apiKey = options.apiKey;
    this.defaultModel = options.defaultModel ?? DEFAULT_OPENROUTER_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async completeStructured(
    request: StructuredCompletionRequest,
  ): Promise<StructuredCompletionResult> {
    const model = request.model ?? this.defaultModel;
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: request.messages,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: request.schemaName,
              schema: request.responseSchema,
              strict: true,
            },
          },
          max_tokens: request.maxOutputTokens,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new LLMTimeoutError(timeoutMs);
      }
      throw new LLMProviderError(
        `OpenRouter request failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable body>');
      throw new LLMProviderError(
        `OpenRouter request failed with status ${response.status}: ${body}`,
      );
    }

    let body: OpenRouterResponseBody;
    try {
      body = (await response.json()) as OpenRouterResponseBody;
    } catch (err) {
      throw new LLMProviderError('OpenRouter response was not valid JSON', err);
    }

    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new LLMProviderError('OpenRouter response contained no message content');
    }

    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (err) {
      throw new LLMProviderError('OpenRouter message content was not valid JSON', err);
    }

    const usage: TokenUsage = {
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
      totalTokens: body.usage?.total_tokens ?? 0,
    };

    return { data, usage, model: body.model ?? model };
  }
}
