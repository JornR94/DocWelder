import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage, LLMProvider } from '../adapters/llm-provider/interface.js';
import type { DocStyleConfig } from '../config/doc-style-config.js';
import { validateReadme } from '../validators/structural.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.docs']);

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.java': 'java',
  '.sh': 'bash',
  '.yml': 'yaml',
  '.yaml': 'yaml',
};

export interface RepoSummary {
  name: string;
  description?: string;
  topLevelEntries: string[];
  languageCounts: Record<string, number>;
}

function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function walkCount(dir: string, counts: Record<string, number>, depth: number): void {
  if (depth > 4) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkCount(full, counts, depth + 1);
    } else {
      const dot = entry.name.lastIndexOf('.');
      const ext = dot >= 0 ? entry.name.slice(dot) : '';
      const lang = LANGUAGE_BY_EXT[ext];
      if (lang) counts[lang] = (counts[lang] ?? 0) + 1;
    }
  }
}

/** Lightweight "codebase analysis" for README generation (spec `repo-init`: task 9.5). */
export function analyzeRepo(cwd: string): RepoSummary {
  let name = basenameOf(cwd);
  let description: string | undefined;
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        name?: string;
        description?: string;
      };
      if (pkg.name) name = pkg.name;
      description = pkg.description;
    } catch {
      // malformed package.json — fall back to directory name only
    }
  }

  const topLevelEntries = readdirSync(cwd).filter(
    (entry) => !SKIP_DIRS.has(entry) && !entry.startsWith('.'),
  );
  const languageCounts: Record<string, number> = {};
  walkCount(cwd, languageCounts, 0);

  return { name, description, topLevelEntries, languageCounts };
}

export function detectPrimaryLanguages(counts: Record<string, number>, max = 5): string[] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([lang]) => lang);
}

export interface ReadmeGenerationResult {
  content: string;
  errors: string[];
}

/**
 * LLM-driven README generation with a small bounded validator-retry loop
 * (spec `repo-init`: "generates a README from codebase analysis"). On
 * exhaustion, returns the last draft alongside its remaining errors so the
 * caller can decide whether an imperfect README beats no README at all.
 */
export async function generateReadme(
  llmProvider: LLMProvider,
  summary: RepoSummary,
  config: DocStyleConfig,
  repoRoot: string,
  maxAttempts = 3,
): Promise<ReadmeGenerationResult> {
  const schema = {
    type: 'object',
    properties: { content: { type: 'string' } },
    required: ['content'],
    additionalProperties: false,
  };
  const systemPrompt =
    `You write README.md files for software repositories. Always include these sections: ` +
    `${config.structural_rules.required_readme_sections.join(', ')}. Keep each section under ` +
    `${config.structural_rules.max_word_count_per_section} words and heading depth to at most ` +
    `${config.structural_rules.heading_depth_limit}. Respond only with structured JSON matching the schema.`;
  const userPrompt =
    `Repository name: ${summary.name}\n` +
    `Description: ${summary.description ?? '(none)'}\n` +
    `Top-level entries: ${summary.topLevelEntries.join(', ') || '(none)'}\n` +
    `Detected languages: ${Object.keys(summary.languageCounts).join(', ') || '(unknown)'}`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let lastContent = '';
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await llmProvider.completeStructured({
      messages,
      responseSchema: schema,
      schemaName: 'docwelder_readme',
    });
    const data = result.data as { content?: string };
    const content = typeof data.content === 'string' ? data.content : '';
    const errors = validateReadme(content, config.structural_rules, repoRoot);
    lastContent = content;
    lastErrors = errors;
    if (errors.length === 0) {
      return { content, errors: [] };
    }
    messages.push(
      { role: 'assistant' as const, content: JSON.stringify(data) },
      {
        role: 'user' as const,
        content: `The draft failed validation:\n${errors.join('\n')}\nPlease produce a corrected version.`,
      },
    );
  }
  return { content: lastContent, errors: lastErrors };
}
