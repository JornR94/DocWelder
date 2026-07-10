export interface ChangelogEntryToAppend {
  category: string;
  description: string;
}

const UNRELEASED_HEADING = /^##\s*\[Unreleased\]/i;
const H2_HEADING = /^##\s+/;

function categoryHeadingRegex(category: string): RegExp {
  const escaped = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^###\\s*${escaped}\\s*$`, 'i');
}

/**
 * Appends one Keep a Changelog bullet under `## [Unreleased]` / `### <Category>`,
 * creating either heading if absent, and preserving everything else byte-for-byte.
 * Used by `docwelder propose` to append a single new entry on every run (as
 * opposed to `docwelder init`'s bulk generation from git history).
 */
export function appendChangelogEntry(existing: string, entry: ChangelogEntryToAppend): string {
  const hadContent = existing.trim().length > 0;
  const lines = hadContent ? existing.replace(/\n$/, '').split('\n') : ['# Changelog', ''];

  let unreleasedIndex = lines.findIndex((line) => UNRELEASED_HEADING.test(line));
  if (unreleasedIndex === -1) {
    const firstH1 = lines.findIndex((line) => /^#\s+/.test(line));
    const insertAt = firstH1 === -1 ? 0 : firstH1 + 1;
    lines.splice(insertAt, 0, '', '## [Unreleased]', '');
    unreleasedIndex = lines.findIndex((line) => UNRELEASED_HEADING.test(line));
  }

  let sectionEnd = lines.length;
  for (let i = unreleasedIndex + 1; i < lines.length; i++) {
    if (H2_HEADING.test(lines[i]!)) {
      sectionEnd = i;
      break;
    }
  }

  const categoryRegex = categoryHeadingRegex(entry.category);
  let categoryIndex = -1;
  for (let i = unreleasedIndex + 1; i < sectionEnd; i++) {
    if (categoryRegex.test(lines[i]!)) {
      categoryIndex = i;
      break;
    }
  }

  const bullet = `- ${entry.description}`;

  if (categoryIndex === -1) {
    let insertAt = unreleasedIndex + 1;
    while (insertAt < sectionEnd && lines[insertAt]!.trim() === '') insertAt++;
    lines.splice(insertAt, 0, `### ${entry.category}`, bullet, '');
  } else {
    let categoryEnd = sectionEnd;
    for (let i = categoryIndex + 1; i < sectionEnd; i++) {
      if (/^#{2,3}\s+/.test(lines[i]!)) {
        categoryEnd = i;
        break;
      }
    }
    let insertAt = categoryEnd;
    while (insertAt > categoryIndex + 1 && lines[insertAt - 1]!.trim() === '') insertAt--;
    lines.splice(insertAt, 0, bullet);
  }

  return lines.join('\n') + '\n';
}
