import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import type { LLMProvider } from '../adapters/llm-provider/interface.js';
import type { WikiPageSummary } from '../adapters/wiki-backend/interface.js';
import { parseMapping, type MappingFile } from '../config/mapping.js';

const MappingProposalSchema = z.object({
  mappings: z.array(z.object({ code_path: z.string().min(1), wiki_path: z.string().min(1) })),
});

const MAPPING_PROPOSAL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    mappings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { code_path: { type: 'string' }, wiki_path: { type: 'string' } },
        required: ['code_path', 'wiki_path'],
        additionalProperties: false,
      },
    },
  },
  required: ['mappings'],
  additionalProperties: false,
};

/**
 * AI-proposed first draft of `.docs/mapping.yaml` (spec `repo-init`:
 * "AI-proposed explicit mapping"). Falls back to an empty mapping on any
 * LLM/parse failure — a first draft is a convenience, never a hard
 * requirement of `init` succeeding.
 */
export async function proposeMapping(
  llmProvider: LLMProvider,
  topLevelEntries: string[],
  wikiCandidates: WikiPageSummary[],
): Promise<MappingFile> {
  const messages = [
    {
      role: 'system' as const,
      content:
        'You propose a mapping from code path globs to wiki page paths for a documentation tool. ' +
        'Only propose mappings you are reasonably confident about; it is fine to return an empty list.',
    },
    {
      role: 'user' as const,
      content:
        `Top-level code directories: ${topLevelEntries.join(', ') || '(none)'}\n` +
        `Candidate wiki pages (path, matchScore): ${
          wikiCandidates.map((c) => `${c.path} (${c.matchScore.toFixed(2)})`).join(', ') ||
          '(none found)'
        }`,
    },
  ];
  try {
    const result = await llmProvider.completeStructured({
      messages,
      responseSchema: MAPPING_PROPOSAL_JSON_SCHEMA,
      schemaName: 'docwelder_mapping_proposal',
    });
    const parsed = MappingProposalSchema.safeParse(result.data);
    return parsed.success ? parsed.data : { mappings: [] };
  } catch {
    return { mappings: [] };
  }
}

/** Opens `$EDITOR` on the proposed mapping; returns it unchanged if `EDITOR` isn't set. */
export function editMappingInEditor(
  proposed: MappingFile,
  editorSpawn: typeof spawnSync = spawnSync,
): MappingFile {
  const editor = process.env.EDITOR;
  if (!editor) {
    return proposed;
  }
  const tmpFile = join(
    tmpdir(),
    `docwelder-mapping-${process.pid}-${Math.floor(Math.random() * 1e6)}.yaml`,
  );
  writeFileSync(tmpFile, stringifyYaml(proposed));
  editorSpawn(editor, [tmpFile], { stdio: 'inherit' });
  const edited = readFileSync(tmpFile, 'utf8');
  return parseMapping(edited, tmpFile);
}
