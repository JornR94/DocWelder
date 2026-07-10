import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../../../src/logging/logger.js';
import { runSelfUpdate } from '../../../src/commands/self-update.js';
import { DOCWELDER_VERSION } from '../../../src/version.js';

function fakeFetch(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status })) as unknown as typeof fetch;
}

function makeLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  return { logger: new Logger({ sink: (line) => lines.push(line) }), lines };
}

describe('runSelfUpdate', () => {
  let dir: string;
  let pinFilePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docwelder-self-update-'));
    pinFilePath = join(dir, 'pinned-image-tag');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a newer pin when the feed reports a newer version', async () => {
    writeFileSync(pinFilePath, '1.0.0\n');
    const { logger, lines } = makeLogger();
    const code = await runSelfUpdate({ logger, pinFilePath, fetchImpl: fakeFetch(200, '1.2.0\n') });
    expect(code).toBe(0);
    expect(readFileSync(pinFilePath, 'utf8').trim()).toBe('1.2.0');
    expect(lines.join(' ')).toContain('1.0.0');
    expect(lines.join(' ')).toContain('1.2.0');
  });

  it('exits 0 reporting no update needed when already at the latest version', async () => {
    writeFileSync(pinFilePath, '1.2.0\n');
    const { logger, lines } = makeLogger();
    const code = await runSelfUpdate({ logger, pinFilePath, fetchImpl: fakeFetch(200, '1.2.0\n') });
    expect(code).toBe(0);
    expect(lines.join(' ')).toMatch(/no update needed/i);
  });

  it('falls back to the image-baked DOCWELDER_VERSION when no pin file exists yet', async () => {
    const missingPinFile = join(dir, 'does-not-exist');
    const { logger } = makeLogger();
    // Feed reports the same version as the image's own baked-in version.
    const code = await runSelfUpdate({
      logger,
      pinFilePath: missingPinFile,
      fetchImpl: fakeFetch(200, `${DOCWELDER_VERSION}\n`),
    });
    expect(code).toBe(0);
  });
});
