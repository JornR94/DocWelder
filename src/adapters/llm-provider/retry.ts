import type { ChatMessage } from './interface.js';

/**
 * Re-prompt helper (task 5.3): carries the prior draft and the structural
 * validator's errors back to the model so the next completion can correct
 * them, per design D7's bounded-retry loop.
 */
export function appendValidationRetry(
  messages: ChatMessage[],
  priorDraft: unknown,
  validatorErrors: string[],
): ChatMessage[] {
  const errorList = validatorErrors.map((error, index) => `${index + 1}. ${error}`).join('\n');
  return [
    ...messages,
    { role: 'assistant', content: JSON.stringify(priorDraft) },
    {
      role: 'user',
      content:
        'The previous structured output failed validation with the following error(s):\n' +
        errorList +
        '\n\nProduce a corrected structured output that satisfies all of the requirements above ' +
        'and fixes every error listed. Keep everything else from the prior draft that was not ' +
        'flagged as an error.',
    },
  ];
}
