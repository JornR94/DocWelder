import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = join(process.cwd(), 'release', 'install.sh');

/**
 * No real macOS/Linux runner matrix is available in this sandbox (task
 * 14.12 asks for "shell tests exercising the install path on macOS and
 * Linux runners"). Substituted here with: a syntax check (portable across
 * both platforms' bash) and a behavior check of the "missing container
 * runtime" error path with PATH stubbed so neither docker nor podman
 * resolves — the two things we can meaningfully verify without Docker/Podman
 * actually installed or a second OS available.
 */
describe('release/install.sh', () => {
  it('is syntactically valid bash', () => {
    expect(() => execFileSync('bash', ['-n', SCRIPT_PATH], { stdio: 'pipe' })).not.toThrow();
  });

  it('exits non-zero naming docker and podman when neither is on PATH', () => {
    // A minimal PATH covering only the core utilities the script itself
    // needs (uname, cat, mkdir, dirname, command) — deliberately excludes
    // /usr/local/bin, /opt/homebrew/bin, etc. where docker/podman typically
    // live, so neither resolves regardless of what's installed on the host
    // running this test.
    const minimalPath = '/usr/bin:/bin';
    const home = mkdtempSync(join(tmpdir(), 'docwelder-home-'));
    try {
      let stderr = '';
      let status = 0;
      try {
        execFileSync('bash', [SCRIPT_PATH], {
          stdio: 'pipe',
          env: { HOME: home, PATH: minimalPath },
        });
      } catch (err) {
        const e = err as { status?: number; stderr?: Buffer };
        status = e.status ?? 1;
        stderr = e.stderr?.toString() ?? '';
      }
      expect(status).not.toBe(0);
      expect(stderr).toMatch(/docker/i);
      expect(stderr).toMatch(/podman/i);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
