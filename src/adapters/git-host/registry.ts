import { AdapterRegistry } from '../registry.js';
import { GitlabHost } from './gitlab.js';
import type { GitHost } from './interface.js';

export interface GitHostOptions {
  serverHost: string;
  projectId: string;
  projectPath: string;
  apiBaseUrl?: string;
  mergeRequestIid?: string;
}

export const gitHostRegistry = new AdapterRegistry<GitHost, GitHostOptions>('git-host');

gitHostRegistry.register({
  name: 'gitlab',
  requiredCredentials: ['GITLAB_BOT_TOKEN'],
  factory: (credentials, options) =>
    new GitlabHost({
      token: credentials.GITLAB_BOT_TOKEN!,
      serverHost: options.serverHost,
      projectId: options.projectId,
      projectPath: options.projectPath,
      apiBaseUrl: options.apiBaseUrl,
      mergeRequestIid: options.mergeRequestIid,
    }),
});
