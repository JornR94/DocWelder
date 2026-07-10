import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LLMProvider,
  StructuredCompletionResult,
} from '../../../src/adapters/llm-provider/interface.js';
import { parseDocStyleConfig } from '../../../src/config/doc-style-config.js';
import {
  analyzeRepo,
  detectPrimaryLanguages,
  generateReadme,
} from '../../../src/pipeline/readme-generation.js';

const CONFIG = parseDocStyleConfig(`
wiki_backend:
  organization: contoso
  project: docs
  wiki_identifier: team-wiki
`);

function fakeLlm(responses: string[]): LLMProvider {
  let call = 0;
  return {
    name: 'fake',
    completeStructured: vi.fn(async (): Promise<StructuredCompletionResult> => {
      const content = responses[Math.min(call, responses.length - 1)]!;
      call += 1;
      return {
        data: { content },
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        model: 'fake-model',
      };
    }),
  };
}

describe('analyzeRepo / detectPrimaryLanguages', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'docwelder-readme-analyze-'));
    writeFileSync(
      join(repoRoot, 'package.json'),
      JSON.stringify({ name: 'my-pkg', description: 'A pkg' }),
    );
    writeFileSync(join(repoRoot, 'index.ts'), '');
    writeFileSync(join(repoRoot, 'other.ts'), '');
    writeFileSync(join(repoRoot, 'script.py'), '');
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('reads name/description from package.json and counts languages', () => {
    const summary = analyzeRepo(repoRoot);
    expect(summary.name).toBe('my-pkg');
    expect(summary.description).toBe('A pkg');
    expect(summary.languageCounts.typescript).toBe(2);
    expect(summary.languageCounts.python).toBe(1);
  });

  it('ranks primary languages by frequency', () => {
    const summary = analyzeRepo(repoRoot);
    expect(detectPrimaryLanguages(summary.languageCounts)[0]).toBe('typescript');
  });
});

describe('generateReadme', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'docwelder-readme-gen-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns the first draft when it already passes validation', async () => {
    const readme = '# proj\n\n## Installation\n\ntext\n\n## Usage\n\ntext\n';
    const llm = fakeLlm([readme]);
    const result = await generateReadme(
      llm,
      { name: 'proj', topLevelEntries: [], languageCounts: {} },
      CONFIG,
      repoRoot,
    );
    expect(result.errors).toEqual([]);
    expect(result.content).toBe(readme);
    expect(llm.completeStructured).toHaveBeenCalledTimes(1);
  });

  it('retries on validator failure and succeeds on a later attempt', async () => {
    const bad = '# proj\n\n## Usage\n\ntext\n'; // missing Installation
    const good = '# proj\n\n## Installation\n\ntext\n\n## Usage\n\ntext\n';
    const llm = fakeLlm([bad, good]);
    const result = await generateReadme(
      llm,
      { name: 'proj', topLevelEntries: [], languageCounts: {} },
      CONFIG,
      repoRoot,
      3,
    );
    expect(result.errors).toEqual([]);
    expect(result.content).toBe(good);
    expect(llm.completeStructured).toHaveBeenCalledTimes(2);
  });

  it('returns the last draft with remaining errors after exhausting retries', async () => {
    const bad = '# proj\n\n## Usage\n\ntext\n';
    const llm = fakeLlm([bad]);
    const result = await generateReadme(
      llm,
      { name: 'proj', topLevelEntries: [], languageCounts: {} },
      CONFIG,
      repoRoot,
      2,
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.content).toBe(bad);
    expect(llm.completeStructured).toHaveBeenCalledTimes(2);
  });
});
