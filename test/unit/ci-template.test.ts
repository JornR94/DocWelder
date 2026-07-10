import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

interface CiJob {
  image?: string;
  variables?: Record<string, string>;
  rules?: { if?: string }[];
  resource_group?: string;
  script?: string[];
  cache?: unknown;
}

describe('release/ci-template.yml', () => {
  const template = parseYaml(readFileSync('release/ci-template.yml', 'utf8')) as Record<
    string,
    CiJob
  >;

  it('defines exactly the two Docwelder jobs', () => {
    expect(Object.keys(template).sort()).toEqual(['docwelder-propose', 'docwelder-publish']);
  });

  it('gates docwelder-propose on merge_request_event and sets GIT_DEPTH: 0', () => {
    const job = template['docwelder-propose']!;
    expect(job.rules?.some((r) => r.if?.includes('merge_request_event'))).toBe(true);
    expect(job.variables?.GIT_DEPTH).toBe('0');
  });

  it('gates docwelder-publish on the default branch and sets resource_group', () => {
    const job = template['docwelder-publish']!;
    expect(job.rules?.some((r) => r.if?.includes('CI_DEFAULT_BRANCH'))).toBe(true);
    expect(job.resource_group).toBe('docwelder-publish');
  });

  it('declares no cache: block on either job', () => {
    expect(template['docwelder-propose']!.cache).toBeUndefined();
    expect(template['docwelder-publish']!.cache).toBeUndefined();
  });

  it('pins both jobs to the same image tag', () => {
    expect(template['docwelder-propose']!.image).toBe(template['docwelder-publish']!.image);
    expect(template['docwelder-propose']!.image).toMatch(/^ghcr\.io\/.+:\d+\.\d+\.\d+$/);
  });
});
