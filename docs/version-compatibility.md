# Version compatibility: container image ↔ CI template

Docwelder's container image and its GitLab CI include template are versioned **in lockstep, one-to-one** (design decision D1). Template `vX.Y.Z` is compatible only with image `vX.Y.Z`.

## Why

The CI template (`release/ci-template.yml`) pins `image: ghcr.io/jornr94/docwelder:X.Y.Z` on both jobs and sets a `DOCWELDER_TEMPLATE_VERSION: "X.Y.Z"` job variable. At startup, every `docwelder` invocation compares that variable (when present — i.e., only inside a CI job that set it) against its own build's `DOCWELDER_VERSION` (from `src/version.ts` / `src/version-check.ts`). A mismatch refuses to run anything and prints both versions, rather than silently running against an incompatible contract.

Local commands (`init-user`, `init`, `upgrade`, `self-update`) never see `DOCWELDER_TEMPLATE_VERSION` and always pass this check trivially — the compatibility contract only matters for the pipeline jobs (`propose`/`publish`), where the image and the template are two independently-fetched artifacts that could otherwise drift.

## Keeping them in sync

- `docwelder init` writes a `.gitlab-ci.yml` pinning the template at the version of Docwelder that ran `init`.
- `docwelder upgrade` rewrites the pinned version in an onboarded repo's `.gitlab-ci.yml` to the latest available release, in one atomic edit — you will never end up with a template version newer than the image tag it references, because they're published together (see [release wiring](../.github/workflows/release.yml)).
- Manually editing the `include:` URL's version segment without a corresponding reason to do so is user error, and the startup check above will catch a resulting drift the next time a pipeline job runs.

## Where the versions are set

| Artifact | Where the version is set |
| --- | --- |
| Container image tag | `release/build-image.sh` reads `VERSION` and tags `ghcr.io/jornr94/docwelder:<version>` |
| CI template's `image:` and `DOCWELDER_TEMPLATE_VERSION` | `release/ci-template.yml`, stamped by the release pipeline from `VERSION` |
| `.gitlab-ci.yml`'s pinned include URL (per onboarded repo) | Written by `docwelder init`, updated by `docwelder upgrade` |
| Local wrapper's pinned tag | Written by `release/install.sh`, updated by `docwelder self-update` |

All four ultimately derive from the single `VERSION` file at the repo root (task 1.5's single-source-of-truth).
