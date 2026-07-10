import { AdapterRegistry } from '../registry.js';
import type { WikiBackend } from './interface.js';
import { AdoWikiBackend } from './ado.js';

/** Non-secret ADO connection context; read from committed `.docs/config.yaml`, never from CI variables. */
export interface AdoWikiBackendOptions {
  organization: string;
  project: string;
  wikiIdentifier: string;
}

export const wikiBackendRegistry = new AdapterRegistry<WikiBackend, AdoWikiBackendOptions>(
  'wiki-backend',
);

wikiBackendRegistry.register({
  name: 'azure-devops-wiki',
  requiredCredentials: ['ADO_WIKI_PAT'],
  factory: (credentials, options) =>
    new AdoWikiBackend({
      organization: options.organization,
      project: options.project,
      wikiIdentifier: options.wikiIdentifier,
      personalAccessToken: credentials.ADO_WIKI_PAT!,
    }),
});
