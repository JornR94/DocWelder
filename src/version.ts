import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Single source of truth for Docwelder's version.
 *
 * The image tag, the CI include template URL, and the local wrapper's pinned
 * tag all derive from this file at build/release time (tasks 1.5, 12.2, 13.2,
 * 14.4) so the three can never drift independently.
 */
function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/version.js -> ../VERSION ; src/version.ts (via tsx) -> ../VERSION
  const candidates = [join(here, '..', 'VERSION'), join(here, 'VERSION')];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8').trim();
    } catch {
      continue;
    }
  }
  throw new Error(`Unable to locate VERSION file from ${here}`);
}

export const DOCWELDER_VERSION = readVersion();
