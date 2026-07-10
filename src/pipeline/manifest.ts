import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

/**
 * `.docs/wiki-staging/manifest.yaml` — written by `docwelder propose`, read
 * (and, on full success, deleted along with the whole `wiki-staging/` tree)
 * by `docwelder publish` (design D5, spec `mr-proposal-pipeline` /
 * `wiki-publisher`). `source_etag` is present only for `update` entries.
 */
export const ManifestEntrySchema = z
  .object({
    wiki_path: z.string().min(1),
    operation: z.enum(['update', 'create']),
    local_file: z.string().min(1),
    source_etag: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.operation === 'update' && !entry.source_etag) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'update entries must include source_etag',
        path: ['source_etag'],
      });
    }
    if (entry.operation === 'create' && entry.source_etag) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'create entries must not include source_etag',
        path: ['source_etag'],
      });
    }
  });

export const ManifestSchema = z.object({
  entries: z.array(ManifestEntrySchema).default([]),
});

export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

export const WIKI_STAGING_DIR = '.docs/wiki-staging';
export const MANIFEST_PATH = `${WIKI_STAGING_DIR}/manifest.yaml`;
export const STAGING_PAGES_DIR = `${WIKI_STAGING_DIR}/pages`;

export function parseManifest(raw: string): Manifest {
  return ManifestSchema.parse(parseYaml(raw) ?? {});
}

export function serializeManifest(manifest: Manifest): string {
  return stringifyYaml(manifest);
}
