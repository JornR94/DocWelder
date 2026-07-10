import { mkdtempSync, rmSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../../../src/logging/logger.js';
import { loadUserConfig, saveUserConfig } from '../../../src/config/user-config.js';
import { runInitUser, type Prompter } from '../../../src/commands/init-user.js';

function fakePrompter(answers: {
  selects?: unknown[];
  inputs?: string[];
  passwords?: string[];
  confirms?: boolean[];
}): Prompter {
  const selects = [...(answers.selects ?? [])];
  const inputs = [...(answers.inputs ?? [])];
  const passwords = [...(answers.passwords ?? [])];
  const confirms = [...(answers.confirms ?? [])];
  return {
    select: (() => Promise.resolve(selects.shift())) as Prompter['select'],
    input: (() => Promise.resolve(inputs.shift() ?? '')) as Prompter['input'],
    password: (() => Promise.resolve(passwords.shift() ?? '')) as Prompter['password'],
    confirm: (() => Promise.resolve(confirms.shift() ?? false)) as Prompter['confirm'],
  };
}

function makeLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  return { logger: new Logger({ sink: (line) => lines.push(line) }), lines };
}

describe('runInitUser', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docwelder-init-user-'));
    configPath = join(dir, 'config.yaml');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('fresh install prompts for all fields and persists at mode 0600', async () => {
    const { logger } = makeLogger();
    const prompter = fakePrompter({
      selects: ['azure-devops-wiki', 'openrouter'],
      inputs: ['contoso', 'docs', 'team-wiki'],
      passwords: ['ado-pat-value', 'sk-or-value'],
    });

    const code = await runInitUser({ logger, configPath, prompter });
    expect(code).toBe(0);

    const saved = loadUserConfig(configPath);
    expect(saved).toEqual({
      wikiBackend: {
        type: 'azure-devops-wiki',
        organization: 'contoso',
        project: 'docs',
        wikiIdentifier: 'team-wiki',
        personalAccessToken: 'ado-pat-value',
      },
      llmProvider: { type: 'openrouter', apiKey: 'sk-or-value', model: null },
    });

    const mode = statSync(configPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('re-run leaves the file unchanged when every field update is declined', async () => {
    saveUserConfig(
      {
        wikiBackend: {
          type: 'azure-devops-wiki',
          organization: 'contoso',
          project: 'docs',
          wikiIdentifier: 'team-wiki',
          personalAccessToken: 'original-pat',
        },
        llmProvider: { type: 'openrouter', apiKey: 'original-key', model: null },
      },
      configPath,
    );

    const { logger } = makeLogger();
    const prompter = fakePrompter({ confirms: [false, false] });
    const code = await runInitUser({ logger, configPath, prompter });
    expect(code).toBe(0);

    expect(loadUserConfig(configPath)?.wikiBackend.personalAccessToken).toBe('original-pat');
    expect(loadUserConfig(configPath)?.llmProvider.apiKey).toBe('original-key');
  });

  it('re-run updates only the field whose confirmation is accepted', async () => {
    saveUserConfig(
      {
        wikiBackend: {
          type: 'azure-devops-wiki',
          organization: 'contoso',
          project: 'docs',
          wikiIdentifier: 'team-wiki',
          personalAccessToken: 'original-pat',
        },
        llmProvider: { type: 'openrouter', apiKey: 'original-key', model: null },
      },
      configPath,
    );

    const { logger } = makeLogger();
    const prompter = fakePrompter({
      confirms: [true, false],
      selects: ['azure-devops-wiki'],
      inputs: ['new-org', 'new-project', 'new-wiki'],
      passwords: ['new-pat'],
    });
    const code = await runInitUser({ logger, configPath, prompter });
    expect(code).toBe(0);

    const updated = loadUserConfig(configPath);
    expect(updated?.wikiBackend.organization).toBe('new-org');
    expect(updated?.wikiBackend.personalAccessToken).toBe('new-pat');
    expect(updated?.llmProvider.apiKey).toBe('original-key');
  });

  it('warns when the config file is world-readable', async () => {
    saveUserConfig(
      {
        wikiBackend: {
          type: 'azure-devops-wiki',
          organization: 'contoso',
          project: 'docs',
          wikiIdentifier: 'team-wiki',
          personalAccessToken: 'original-pat',
        },
        llmProvider: { type: 'openrouter', apiKey: 'original-key', model: null },
      },
      configPath,
    );
    chmodSync(configPath, 0o644);

    const { logger, lines } = makeLogger();
    const prompter = fakePrompter({ confirms: [false, false] });
    await runInitUser({ logger, configPath, prompter });

    expect(lines.some((l) => l.includes('WARN') && l.includes('chmod 600'))).toBe(true);
  });
});
