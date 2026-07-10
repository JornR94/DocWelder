import { describe, expect, it } from 'vitest';
import { ConfigValidationError } from '../../../src/config/errors.js';
import { parseDocStyleConfig } from '../../../src/config/doc-style-config.js';

const MINIMAL_VALID = `
wiki_backend:
  organization: contoso
  project: docs
  wiki_identifier: team-wiki
`;

describe('parseDocStyleConfig', () => {
  it('applies documented defaults when only the required wiki_backend block is given', () => {
    const config = parseDocStyleConfig(MINIMAL_VALID);
    expect(config.structural_rules).toEqual({
      required_readme_sections: ['Installation', 'Usage'],
      max_word_count_per_section: 400,
      heading_depth_limit: 4,
      code_block_language_whitelist: [],
      changelog_format: 'keep-a-changelog',
    });
    expect(config.style_guidance).toEqual({
      tone: 'mixed-audience',
      audience: 'mixed',
      conciseness: 'balanced',
      code_example_policy: 'mixed-audience',
      diagram_policy: 'mermaid-for-architecture-changes',
      readme_wiki_policy: 'link-to-wiki',
      update_triggers: ['public-api', 'config-env'],
      exclusions: [],
    });
    expect(config.llm).toEqual({ model: null, retry_limit: 3, token_budget: 200_000 });
    expect(config.wiki_backend).toEqual({
      type: 'azure-devops-wiki',
      organization: 'contoso',
      project: 'docs',
      wiki_identifier: 'team-wiki',
    });
  });

  it('accepts a fully populated config overriding every field', () => {
    const raw = `
structural_rules:
  required_readme_sections: [Overview]
  max_word_count_per_section: 100
  heading_depth_limit: 2
  code_block_language_whitelist: [typescript]
  changelog_format: keep-a-changelog
style_guidance:
  tone: formal
  audience: technical
  conciseness: terse
  code_example_policy: always
  diagram_policy: always
  readme_wiki_policy: wiki-only
  update_triggers: [public-api]
  exclusions: ["**/internal/**"]
wiki_backend:
  organization: contoso
  project: docs
  wiki_identifier: team-wiki
llm:
  model: openai/gpt-4o-mini
  retry_limit: 5
  token_budget: 50000
`;
    const config = parseDocStyleConfig(raw);
    expect(config.structural_rules.heading_depth_limit).toBe(2);
    expect(config.style_guidance.audience).toBe('technical');
    expect(config.llm.model).toBe('openai/gpt-4o-mini');
  });

  it('throws ConfigValidationError with a line number on malformed YAML', () => {
    const raw = `wiki_backend:\n  organization: [unterminated\n`;
    expect(() => parseDocStyleConfig(raw, '.docs/config.yaml')).toThrow(ConfigValidationError);
    try {
      parseDocStyleConfig(raw, '.docs/config.yaml');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const validationError = err as ConfigValidationError;
      expect(validationError.filePath).toBe('.docs/config.yaml');
      expect(validationError.details[0]?.line).toBeDefined();
    }
  });

  it('throws ConfigValidationError naming an unknown top-level field', () => {
    const raw = `${MINIMAL_VALID}\nnot_a_real_field: true\n`;
    try {
      parseDocStyleConfig(raw, '.docs/config.yaml');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const validationError = err as ConfigValidationError;
      expect(validationError.details.some((d) => d.field === 'not_a_real_field')).toBe(true);
    }
  });

  it('throws ConfigValidationError when a required wiki_backend field is missing', () => {
    const raw = `wiki_backend:\n  organization: contoso\n  project: docs\n`;
    try {
      parseDocStyleConfig(raw, '.docs/config.yaml');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const validationError = err as ConfigValidationError;
      expect(validationError.details.some((d) => d.field === 'wiki_backend.wiki_identifier')).toBe(
        true,
      );
    }
  });
});
