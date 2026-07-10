#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { DOCWELDER_VERSION } from './version.js';
import { Logger } from './logging/logger.js';
import { runInitUser } from './commands/init-user.js';
import { runInit } from './commands/init.js';
import { runPropose } from './commands/propose.js';
import { runPublish } from './commands/publish.js';
import { runUpgrade } from './commands/upgrade.js';
import { runSelfUpdate } from './commands/self-update.js';
import { checkVersionCompatibility } from './version-check.js';

function buildProgram(): Command {
  const program = new Command();

  program
    .name('docwelder')
    .description('Semi-automated, user-confirmed documentation sync for your codebase.')
    .version(DOCWELDER_VERSION, '--version', "output docwelder's version")
    .option('--json-logs', 'emit machine-parseable JSON logs instead of plain text')
    .option('--log-level <level>', 'debug | info | warn | error', 'info');

  const withLogger = (commandName: string): Logger => {
    const opts = program.opts<{ jsonLogs?: boolean; logLevel?: string }>();
    const level =
      opts.logLevel === 'debug' ||
      opts.logLevel === 'info' ||
      opts.logLevel === 'warn' ||
      opts.logLevel === 'error'
        ? opts.logLevel
        : 'info';
    return new Logger({ json: opts.jsonLogs, level }).child(commandName);
  };

  const exitOn = (result: Promise<number>): void => {
    result
      .then((code) => process.exit(code))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`docwelder: ${message}\n`);
        process.exit(1);
      });
  };

  program
    .command('init-user')
    .description('First-install, per-machine setup: wiki backend + LLM provider credentials')
    .action(() => exitOn(runInitUser({ logger: withLogger('init-user') })));

  program
    .command('init')
    .description('Onboard the current repository to Docwelder')
    .action(() => exitOn(runInit({ logger: withLogger('init') })));

  program
    .command('propose')
    .description('Generate doc proposals for the current merge request (runs in CI)')
    .action(() => exitOn(runPropose({ logger: withLogger('propose') })));

  program
    .command('publish')
    .description('Publish staged wiki proposals after merge to default branch (runs in CI)')
    .action(() => exitOn(runPublish({ logger: withLogger('publish') })));

  program
    .command('upgrade')
    .description("Bump this repository's pinned Docwelder CI template version")
    .action(() => exitOn(runUpgrade({ logger: withLogger('upgrade') })));

  program
    .command('self-update')
    .description("Bump the local wrapper's pinned Docwelder image tag")
    .action(() => exitOn(runSelfUpdate({ logger: withLogger('self-update') })));

  return program;
}

export { buildProgram };

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const versionCheck = checkVersionCompatibility();
  if (!versionCheck.ok) {
    process.stderr.write(`docwelder: ${versionCheck.message}\n`);
    process.exit(1);
  }

  buildProgram()
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`docwelder: ${message}\n`);
      process.exit(1);
    });
}
