import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { runInit, type Prompter } from '../../../src/commands/init.js';
import { Logger } from '../../../src/logging/logger.js';
import type { UserConfig } from '../../../src/config/user-config.js';
import type { WikiBackend } from '../../../src/adapters/wiki-backend/interface.js';
import type {
  LLMProvider,
  StructuredCompletionRequest,
  StructuredCompletionResult,
} from '../../../src/adapters/llm-provider/interface.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function initGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'docwelder-init-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  writeFileSync(join(dir, 'a.txt'), 'a');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'feat: initial commit']);
  return dir;
}

function silentLogger(): Logger {
  return new Logger({ sink: () => {} });
}

const USER_CONFIG: UserConfig = {
  wikiBackend: {
    type: 'azure-devops-wiki',
    organization: 'contoso',
    project: 'docs',
    wikiIdentifier: 'team-wiki',
    personalAccessToken: 'pat-secret',
  },
  llmProvider: { type: 'openrouter', apiKey: 'sk-secret', model: null },
};

function fakeWikiBackend(): WikiBackend {
  return {
    name: 'fake-wiki',
    listPages: vi.fn(async () => []),
    getPage: vi.fn(),
    createPage: vi.fn(),
    updatePage: vi.fn(),
  };
}

function fakeLlmProvider(): LLMProvider {
  return {
    name: 'fake-llm',
    completeStructured: vi.fn(
      async (request: StructuredCompletionRequest): Promise<StructuredCompletionResult> => {
        if (request.schemaName === 'docwelder_readme') {
          return {
            data: { content: '# proj\n\n## Installation\n\ntext\n\n## Usage\n\ntext\n' },
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            model: 'fake',
          };
        }
        return {
          data: { mappings: [] },
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          model: 'fake',
        };
      },
    ),
  };
}

function fakePrompter(): Prompter {
  return {
    confirm: vi.fn(),
    select: vi.fn(),
    checkbox: vi.fn(),
    input: vi.fn(),
  } as unknown as Prompter;
}

describe('runInit', () => {
  let cwd: string;

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('produces the full artifact set on a clean repo in default mode', async () => {
    cwd = initGitRepo();
    const prompter = fakePrompter();
    (prompter.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('default') // setup mode
      .mockResolvedValueOnce('accept'); // mapping choice

    const code = await runInit({
      logger: silentLogger(),
      cwd,
      prompter,
      userConfig: USER_CONFIG,
      wikiBackend: fakeWikiBackend(),
      llmProvider: fakeLlmProvider(),
    });

    expect(code).toBe(0);
    expect(existsSync(join(cwd, '.docs', 'config.yaml'))).toBe(true);
    expect(existsSync(join(cwd, '.docs', 'mapping.yaml'))).toBe(true);
    // Deliberately does NOT ignore wiki-staging/ (design D5): those files must stay
    // tracked so `git add -A` in commitAndPush picks them up and they show in the MR diff.
    const gitignoreLines = readFileSync(join(cwd, '.docs', '.gitignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim());
    expect(gitignoreLines).not.toContain('wiki-staging/');
    expect(existsSync(join(cwd, '.gitlab-ci.yml'))).toBe(true);
    expect(existsSync(join(cwd, 'README.md'))).toBe(true);
    expect(existsSync(join(cwd, 'CHANGELOG.md'))).toBe(true);

    const config = parseYaml(readFileSync(join(cwd, '.docs', 'config.yaml'), 'utf8'));
    expect(config.wiki_backend.organization).toBe('contoso');
    expect(config.style_guidance.tone).toBe('mixed-audience');
  });

  it('appends the include line to an existing .gitlab-ci.yml without disturbing other jobs', async () => {
    cwd = initGitRepo();
    writeFileSync(
      join(cwd, '.gitlab-ci.yml'),
      'stages:\n  - test\n\nunit-tests:\n  stage: test\n  script:\n    - npm test\n',
    );
    const prompter = fakePrompter();
    (prompter.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('accept');

    const code = await runInit({
      logger: silentLogger(),
      cwd,
      prompter,
      userConfig: USER_CONFIG,
      wikiBackend: fakeWikiBackend(),
      llmProvider: fakeLlmProvider(),
    });

    expect(code).toBe(0);
    const parsed = parseYaml(readFileSync(join(cwd, '.gitlab-ci.yml'), 'utf8'));
    expect(parsed['unit-tests'].script).toEqual(['npm test']);
    expect(Array.isArray(parsed.include)).toBe(true);
    expect(
      parsed.include.some((e: { remote?: string }) => e.remote?.includes('ci-template.yml')),
    ).toBe(true);
  });

  it('leaves existing README.md and CHANGELOG.md untouched and reports findings', async () => {
    cwd = initGitRepo();
    writeFileSync(join(cwd, 'README.md'), '# proj\n\n## Usage\n\ntext\n'); // missing Installation
    writeFileSync(join(cwd, 'CHANGELOG.md'), '# Changelog\n\nexisting content\n');
    const prompter = fakePrompter();
    (prompter.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('accept');
    const logger = silentLogger();
    const warnSpy = vi.spyOn(logger, 'warn');

    const code = await runInit({
      logger,
      cwd,
      prompter,
      userConfig: USER_CONFIG,
      wikiBackend: fakeWikiBackend(),
      llmProvider: fakeLlmProvider(),
    });

    expect(code).toBe(0);
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('# proj\n\n## Usage\n\ntext\n');
    expect(readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8')).toBe(
      '# Changelog\n\nexisting content\n',
    );
    expect(warnSpy).toHaveBeenCalled();
  });

  it('requires confirmation on re-run and aborts when declined', async () => {
    cwd = initGitRepo();
    execFileSync('mkdir', ['-p', join(cwd, '.docs')]);
    writeFileSync(
      join(cwd, '.docs', 'config.yaml'),
      'wiki_backend:\n  organization: x\n  project: y\n  wiki_identifier: z\n',
    );
    const prompter = fakePrompter();
    (prompter.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const wikiBackend = fakeWikiBackend();
    const code = await runInit({
      logger: silentLogger(),
      cwd,
      prompter,
      userConfig: USER_CONFIG,
      wikiBackend,
      llmProvider: fakeLlmProvider(),
    });

    expect(code).toBe(0);
    expect(wikiBackend.listPages).not.toHaveBeenCalled();
    // config.yaml should be untouched (still the hand-written stub, not a full generated one)
    expect(readFileSync(join(cwd, '.docs', 'config.yaml'), 'utf8')).toContain('organization: x');
  });

  it('refuses to run outside a git repository', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'docwelder-init-nogit-'));
    const code = await runInit({
      logger: silentLogger(),
      cwd,
      userConfig: USER_CONFIG,
    });
    expect(code).toBe(1);
  });

  it('refuses to run without prior docwelder init-user setup', async () => {
    cwd = initGitRepo();
    const code = await runInit({
      logger: silentLogger(),
      cwd,
      userConfig: null,
    });
    expect(code).toBe(1);
  });
});
