import { z } from 'zod';
import type { JsonSchema } from './interface.js';

const KEEP_A_CHANGELOG_CATEGORIES = [
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security',
] as const;

// Full-content replacement rather than a unified diff: LLMs regenerate whole
// files far more reliably than they emit valid patch/diff syntax, and the
// structural validators (task 10.6) operate on final content anyway.
export const ProposalSchema = z.object({
  readme: z
    .object({
      content: z.string(),
    })
    .nullable(),
  changelog: z
    .object({
      category: z.enum(KEEP_A_CHANGELOG_CATEGORIES),
      description: z.string(),
    })
    .nullable(),
  wikiPages: z
    .array(
      z.object({
        path: z.string(),
        operation: z.enum(['update', 'create']),
        content: z.string(),
      }),
    )
    .default([]),
});

export type Proposal = z.infer<typeof ProposalSchema>;

/**
 * Hand-written JSON Schema mirror of {@link ProposalSchema} for the
 * `StructuredCompletionRequest.responseSchema` wire contract (task 5.2).
 */
export function proposalJsonSchema(): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['readme', 'changelog', 'wikiPages'],
    properties: {
      readme: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['content'],
            properties: { content: { type: 'string' } },
          },
          { type: 'null' },
        ],
      },
      changelog: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['category', 'description'],
            properties: {
              category: { type: 'string', enum: [...KEEP_A_CHANGELOG_CATEGORIES] },
              description: { type: 'string' },
            },
          },
          { type: 'null' },
        ],
      },
      wikiPages: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'operation', 'content'],
          properties: {
            path: { type: 'string' },
            operation: { type: 'string', enum: ['update', 'create'] },
            content: { type: 'string' },
          },
        },
      },
    },
  };
}
