import { AdapterRegistry } from '../registry.js';
import type { LLMProvider } from './interface.js';
import { OpenRouterProvider } from './openrouter.js';

export const llmProviderRegistry = new AdapterRegistry<LLMProvider>('llm-provider');

llmProviderRegistry.register({
  name: 'openrouter',
  requiredCredentials: ['OPENROUTER_API_KEY'],
  factory: (credentials) => new OpenRouterProvider({ apiKey: credentials.OPENROUTER_API_KEY! }),
});
