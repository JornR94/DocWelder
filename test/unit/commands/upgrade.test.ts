import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../../../src/logging/logger.js';
import { runUpgrade } from '../../../src/commands/upgrade.js';

function fakeFetch(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status })) as unknown as typeof fetch;
}

function makeLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  return { logger: new Logger({ sink: (line) => lines.push(line) }), lines };
}

const INCLUDE_LINE =
  'include:\n  - remote: https://raw.githubusercontent.com/JornR94/DocWelder/v1.0.0/release/ci-template.yml\n';

describe('runUpgrade', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'docwelder-upgrade-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('rewrites the pinned version and reports the delta when outdated', async () => {
    writeFileSync(join(cwd, '.gitlab-ci.yml'), INCLUDE_LINE);
    const { logger, lines } = makeLogger();
    const code = await runUpgrade({ logger, cwd, fetchImpl: fakeFetch(200, '1.2.0\n') });
    expect(code).toBe(0);
    const rewritten = readFileSync(join(cwd, '.gitlab-ci.yml'), 'utf8');
    expect(rewritten).toContain('/v1.2.0/release/ci-template.yml');
    expect(lines.join(' ')).toContain('1.0.0');
    expect(lines.join(' ')).toContain('1.2.0');
  });

  it('exits 0 reporting no upgrade needed when already at the latest version', async () => {
    writeFileSync(join(cwd, '.gitlab-ci.yml'), INCLUDE_LINE);
    const { logger, lines } = makeLogger();
    const code = await runUpgrade({ logger, cwd, fetchImpl: fakeFetch(200, '1.0.0\n') });
    expect(code).toBe(0);
    expect(lines.join(' ')).toMatch(/no upgrade needed/i);
    expect(readFileSync(join(cwd, '.gitlab-ci.yml'), 'utf8')).toBe(INCLUDE_LINE);
  });

  it('exits non-zero with an actionable error when .gitlab-ci.yml is missing', async () => {
    const { logger, lines } = makeLogger();
    const code = await runUpgrade({ logger, cwd, fetchImpl: fakeFetch(200, '1.2.0\n') });
    expect(code).toBe(1);
    expect(lines.join(' ')).toMatch(/docwelder init/);
  });

  it('exits non-zero with an actionable error on a malformed/unrecognized .gitlab-ci.yml', async () => {
    writeFileSync(join(cwd, '.gitlab-ci.yml'), 'stages:\n  - build\n');
    const { logger, lines } = makeLogger();
    const code = await runUpgrade({ logger, cwd, fetchImpl: fakeFetch(200, '1.2.0\n') });
    expect(code).toBe(1);
    expect(lines.join(' ')).toMatch(/docwelder/i);
  });
});
