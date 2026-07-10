export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** A JSON Schema object describing the required shape of the structured completion. */
export type JsonSchema = Record<string, unknown>;

export interface StructuredCompletionRequest {
  messages: ChatMessage[];
  responseSchema: JsonSchema;
  schemaName: string;
  /** Falls back to the provider's configured default model when omitted. */
  model?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StructuredCompletionResult {
  /** Parsed JSON conforming to `responseSchema`; callers validate against their own zod schema. */
  data: unknown;
  usage: TokenUsage;
  model: string;
}

export class LLMTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`LLM completion timed out after ${timeoutMs}ms`);
    this.name = 'LLMTimeoutError';
  }
}

export class LLMProviderError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LLMProviderError';
  }
}

/**
 * An LLM chat-completion provider (MVP implementation: OpenRouter). Model
 * selection is config-driven (image default, overridable by `.docs/config.yaml`
 * `llm.model`), never hardcoded in a command.
 */
export interface LLMProvider {
  readonly name: string;
  completeStructured(request: StructuredCompletionRequest): Promise<StructuredCompletionResult>;
}
