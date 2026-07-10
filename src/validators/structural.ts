import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { DocStyleConfig } from '../config/doc-style-config.js';

type StructuralRules = DocStyleConfig['structural_rules'];

interface Heading {
  depth: number;
  text: string;
  lineIndex: number;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.docs']);

function extractHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  content.split('\n').forEach((line, lineIndex) => {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      headings.push({ depth: match[1]!.length, text: match[2]!.trim(), lineIndex });
    }
  });
  return headings;
}

function extractCodeBlocks(content: string): { lang: string | null; body: string }[] {
  const blocks: { lang: string | null; body: string }[] = [];
  const regex = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const lang = match[1]!.trim();
    blocks.push({ lang: lang.length > 0 ? lang : null, body: match[2] ?? '' });
  }
  return blocks;
}

/** Every section body up to (exclusive of) the next heading at the same-or-shallower depth. */
function sectionWordCounts(
  content: string,
  headings: Heading[],
): { heading: Heading; words: number }[] {
  const lines = content.split('\n');
  return headings.map((heading, index) => {
    const next = headings.slice(index + 1).find((h) => h.depth <= heading.depth);
    const endLine = next ? next.lineIndex : lines.length;
    const body = lines.slice(heading.lineIndex + 1, endLine).join(' ');
    const words = body.trim().length === 0 ? 0 : body.trim().split(/\s+/).length;
    return { heading, words };
  });
}

function extractReferencedPaths(content: string): string[] {
  const paths = new Set<string>();
  const linkRegex = /\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(content)) !== null) {
    const target = match[1]!.split(/[#?]/)[0]!.trim();
    if (target.length === 0 || /^[a-z]+:\/\//i.test(target) || target.startsWith('mailto:')) {
      continue;
    }
    paths.add(target);
  }
  return [...paths];
}

function extractCliFlags(content: string): string[] {
  const flags = new Set<string>();
  const flagRegex = /(?<![\w-])--[a-zA-Z][a-zA-Z0-9-]*/g;
  let match: RegExpExecArray | null;
  while ((match = flagRegex.exec(content)) !== null) {
    flags.add(match[0]);
  }
  return [...flags];
}

function walk(dir: string, onFile: (path: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, onFile);
    } else if (entry.isFile()) {
      onFile(full);
    }
  }
}

/** Best-effort: does any tracked source file contain this literal substring? */
function repoContainsString(repoRoot: string, needle: string): boolean {
  let found = false;
  try {
    walk(repoRoot, (filePath) => {
      if (found) return;
      try {
        const stats = statSync(filePath);
        if (stats.size > 2_000_000) return; // skip large/binary-ish files
        if (readFileSync(filePath, 'utf8').includes(needle)) found = true;
      } catch {
        // unreadable/binary file — ignore
      }
    });
  } catch {
    // repoRoot missing — treat as not found
  }
  return found;
}

function validateHeadingsAndCodeBlocks(content: string, rules: StructuralRules): string[] {
  const errors: string[] = [];
  for (const heading of extractHeadings(content)) {
    if (heading.depth > rules.heading_depth_limit) {
      errors.push(
        `Heading "${heading.text}" is at depth ${heading.depth}, exceeding heading_depth_limit (${rules.heading_depth_limit})`,
      );
    }
  }
  if (rules.code_block_language_whitelist.length > 0) {
    for (const block of extractCodeBlocks(content)) {
      if (!block.lang || !rules.code_block_language_whitelist.includes(block.lang)) {
        errors.push(
          `Code block with language "${block.lang ?? '(none)'}" is not in code_block_language_whitelist (${rules.code_block_language_whitelist.join(', ')})`,
        );
      }
    }
  }
  return errors;
}

/**
 * Deterministic structural validation for a generated README (spec
 * `mr-proposal-pipeline`, "Deterministic structural validation with bounded
 * retries"). Never depends on the LLM (spec `doc-style-config`).
 */
export function validateReadme(
  content: string,
  rules: StructuralRules,
  repoRoot: string,
): string[] {
  const errors = validateHeadingsAndCodeBlocks(content, rules);

  const headings = extractHeadings(content);
  const headingTexts = headings.map((h) => h.text.toLowerCase());
  for (const required of rules.required_readme_sections) {
    if (!headingTexts.some((text) => text.includes(required.toLowerCase()))) {
      errors.push(`Missing required README section: "${required}"`);
    }
  }

  for (const { heading, words } of sectionWordCounts(content, headings)) {
    if (words > rules.max_word_count_per_section) {
      errors.push(
        `Section "${heading.text}" has ${words} words, exceeding max_word_count_per_section (${rules.max_word_count_per_section})`,
      );
    }
  }

  for (const path of extractReferencedPaths(content)) {
    const resolved = join(repoRoot, path);
    if (!existsSync(resolved)) {
      errors.push(`README references a path that does not exist: "${path}"`);
    }
  }

  for (const flag of extractCliFlags(content)) {
    if (!repoContainsString(repoRoot, flag)) {
      errors.push(`README documents flag "${flag}" which was not found anywhere in the codebase`);
    }
  }

  return errors;
}

const KEEP_A_CHANGELOG_CATEGORIES = [
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security',
] as const;

export interface ChangelogEntryDraft {
  category: string;
  description: string;
}

/** Validates a single Keep a Changelog entry (spec `doc-style-config`: `changelog_format`). */
export function validateChangelogEntry(
  entry: ChangelogEntryDraft,
  rules: StructuralRules,
): string[] {
  const errors: string[] = [];
  if (rules.changelog_format !== 'keep-a-changelog') {
    errors.push(`Unsupported changelog_format: "${rules.changelog_format}"`);
    return errors;
  }
  if (!(KEEP_A_CHANGELOG_CATEGORIES as readonly string[]).includes(entry.category)) {
    errors.push(
      `Changelog category "${entry.category}" is not a Keep a Changelog category (${KEEP_A_CHANGELOG_CATEGORIES.join(', ')})`,
    );
  }
  if (entry.description.trim().length === 0) {
    errors.push('Changelog entry description must not be empty');
  }
  return errors;
}

/** Validates a proposed wiki page body (heading depth + code-block whitelist only — no required sections). */
export function validateWikiPage(content: string, rules: StructuralRules): string[] {
  return validateHeadingsAndCodeBlocks(content, rules);
}

export function relativeToRepoRoot(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath);
}
