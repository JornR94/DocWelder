import { describe, expect, it } from 'vitest';
import { checkVersionCompatibility } from '../../src/version-check.js';
import { DOCWELDER_VERSION } from '../../src/version.js';

describe('checkVersionCompatibility', () => {
  it('passes when DOCWELDER_TEMPLATE_VERSION is unset', () => {
    expect(checkVersionCompatibility({})).toEqual({ ok: true });
  });

  it('passes when the template version matches the image version', () => {
    expect(checkVersionCompatibility({ DOCWELDER_TEMPLATE_VERSION: DOCWELDER_VERSION })).toEqual({
      ok: true,
    });
  });

  it('fails and names both versions when they differ', () => {
    const result = checkVersionCompatibility({ DOCWELDER_TEMPLATE_VERSION: '999.0.0' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(DOCWELDER_VERSION);
      expect(result.message).toContain('999.0.0');
    }
  });
});
