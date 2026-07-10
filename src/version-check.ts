import { DOCWELDER_VERSION } from './version.js';

export type VersionCompatibilityResult = { ok: true } | { ok: false; message: string };

/**
 * The published CI template (`release/ci-template.yml`) sets
 * `DOCWELDER_TEMPLATE_VERSION` to the exact version it was published at.
 * When absent (every local command, and any invocation outside the
 * template), there's nothing to compare — pass. When present and mismatched,
 * refuse to run (spec `distribution`: "Mismatched versions do not silently
 * succeed").
 */
export function checkVersionCompatibility(
  env: NodeJS.ProcessEnv = process.env,
): VersionCompatibilityResult {
  const templateVersion = env.DOCWELDER_TEMPLATE_VERSION;
  if (!templateVersion) {
    return { ok: true };
  }
  if (templateVersion === DOCWELDER_VERSION) {
    return { ok: true };
  }
  return {
    ok: false,
    message:
      `Docwelder version mismatch: this image is version ${DOCWELDER_VERSION}, but the CI template ` +
      `pinned version ${templateVersion}. Run \`docwelder upgrade\` in this repository to bring the ` +
      'CI template and image back in sync.',
  };
}
