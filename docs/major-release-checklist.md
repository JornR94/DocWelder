# MAJOR release announcement checklist

Run through this for every `X.0.0` release (task 18.3). Minor/patch releases don't need it.

- [ ] Confirm `.github/workflows/release.yml` completed successfully for the new tag: image pushed to `ghcr.io/jornr94/docwelder:X.0.0`, CI template and install script both fetchable at their published URLs (see [version-compatibility.md](version-compatibility.md)).
- [ ] Re-state the version-compatibility promise in the announcement: template `vX.0.0` only works with image `vX.0.0`; users on an older template must run `docwelder upgrade` (repo-side) and `docwelder self-update` (machine-side) together, not independently.
- [ ] Call out any breaking changes to:
  - `.docs/config.yaml` or `.docs/mapping.yaml` schemas (would require users to hand-edit committed files)
  - the `GitHost`/`WikiBackend`/`LLMProvider` interfaces (would break any third-party adapters — see [adapters.md](adapters.md))
  - CI variable names or required GitLab/ADO permissions
- [ ] Link the diff between the previous MAJOR's CI template and this one, so users can see exactly what changed in their pipeline.
- [ ] Remind users that `docwelder upgrade` rewrites `.gitlab-ci.yml` locally but does not commit or open an MR on their behalf (design Open Question #8's resolution) — they still need to review and push the change themselves.
- [ ] Post the announcement wherever the project's users are reachable (out of scope for automation — this checklist's completion is itself a manual, human step).
