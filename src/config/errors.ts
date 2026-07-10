import type { ZodIssue } from 'zod';

export interface ConfigErrorDetail {
  field?: string;
  line?: number;
  message: string;
}

/**
 * Fail-fast error for `.docs/config.yaml` and `.docs/mapping.yaml`: always
 * names the file, and includes a line number when the failure was a YAML
 * syntax error (line numbers are not recoverable once a schema-shape error
 * is raised against the already-parsed JS value).
 */
export class ConfigValidationError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly details: ConfigErrorDetail[],
  ) {
    const lines = details.map((d) => {
      const location = d.line !== undefined ? `:${d.line}` : '';
      const field = d.field ? ` (field: ${d.field})` : '';
      return `  - ${filePath}${location}${field}: ${d.message}`;
    });
    super(`Invalid config at ${filePath}:\n${lines.join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Flattens zod issues into config error details, expanding `unrecognized_keys`
 * (raised once per offending object, listing all its extra keys) into one
 * detail per offending field name so callers can pinpoint each one.
 */
export function zodIssuesToConfigDetails(issues: readonly ZodIssue[]): ConfigErrorDetail[] {
  const details: ConfigErrorDetail[] = [];
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        const field = [...issue.path, key].map(String).join('.');
        details.push({ field, message: `Unrecognized field "${key}"` });
      }
    } else {
      details.push({ field: issue.path.join('.') || undefined, message: issue.message });
    }
  }
  return details;
}
