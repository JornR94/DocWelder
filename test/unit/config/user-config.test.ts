import { describe, expect, it } from 'vitest';
import { maskSecrets, parseUserConfig, UserConfigSchema } from '../../../src/config/user-config.js';
import { ConfigValidationError } from '../../../src/config/errors.js';

const VALID = `
wikiBackend:
  organization: contoso
  project: docs
  wikiIdentifier: team-wiki
  personalAccessToken: super-secret-pat
llmProvider:
  apiKey: sk-or-abc123
`;

describe('parseUserConfig', () => {
  it('parses a valid config and defaults llmProvider.model to null', () => {
    const config = parseUserConfig(VALID);
    expect(config.wikiBackend.organization).toBe('contoso');
    expect(config.llmProvider.model).toBeNull();
    expect(UserConfigSchema.safeParse(config).success).toBe(true);
  });

  it('throws ConfigValidationError when a secret field is missing', () => {
    const raw = `
wikiBackend:
  organization: contoso
  project: docs
  wikiIdentifier: team-wiki
llmProvider:
  apiKey: sk-or-abc123
`;
    expect(() => parseUserConfig(raw, '/home/user/.config/docwelder/config.yaml')).toThrow(
      ConfigValidationError,
    );
  });
});

describe('maskSecrets', () => {
  it('masks the PAT and API key while preserving other fields', () => {
    const config = parseUserConfig(VALID);
    const masked = maskSecrets(config) as {
      wikiBackend: { personalAccessToken: string; organization: string };
      llmProvider: { apiKey: string };
    };
    expect(masked.wikiBackend.personalAccessToken).not.toBe('super-secret-pat');
    expect(masked.wikiBackend.personalAccessToken.endsWith('-pat')).toBe(true);
    expect(masked.wikiBackend.organization).toBe('contoso');
    expect(masked.llmProvider.apiKey).not.toBe('sk-or-abc123');
  });
});
