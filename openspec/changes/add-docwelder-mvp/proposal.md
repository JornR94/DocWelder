## Why

Repository documentation drifts from code the moment it's merged. READMEs describe removed flags, CHANGELOGs skip releases, and wiki pages describe last quarter's architecture. Manual sync is unrewarding, easy to skip, and impossible to enforce at review time.

Docwelder makes the codebase the single source of truth for documentation and turns the merge request into the review surface for doc updates. On every MR, Docwelder proposes README, CHANGELOG, and wiki changes derived from the diff; humans review them alongside the code they describe; approved changes ship on merge.

## What Changes

Introduce Docwelder as a standalone, tool-agnostic CLI distributed as a versioned container image. The MVP wires together six capabilities and produces a two-job GitLab CI pipeline plus a small `.docs/` directory in every onboarded repo. Each capability owns any commands it exposes; there is no shared "command surface" spec.

- **First-install, per-machine setup** via `docwelder init-user`, persisting wiki backend selection and LLM provider credentials to `~/.config/docwelder/config.yaml`. Used only by local `docwelder init` runs; never committed.
- **Per-repo initialization** via `docwelder init`, offering a default opinionated mode and an advanced 5-question mode. Detects README and CHANGELOG (generates CHANGELOG from git history when missing); scans the configured wiki for related pages; proposes an explicit code-path → wiki-page mapping for user approval; writes `.docs/config.yaml`, `.docs/mapping.yaml`, and `.gitlab-ci.yml`; prints post-init instructions covering bot user creation, required CI variables, and ADO Wiki permissions.
- **A shared `.docs/config.yaml` schema** covering both deterministic structural rules (required README sections, max word counts, heading depth limit, code-block language whitelist, Keep-a-Changelog format) and soft style guidance (tone, audience, conciseness, code-example policy, diagram policy, README↔wiki policy, update triggers, exclusions). All fields user-editable after init.
- **MR-time proposal pipeline** via `docwelder propose`, invoked by a CI job triggered on `merge_request_event`. Computes `git diff $CI_MERGE_REQUEST_DIFF_BASE_SHA...HEAD`; fetches mapped wiki pages via the ADO Wiki REST API with ETag capture; generates README, CHANGELOG, and wiki proposals via OpenRouter; validates against structural rules with bounded retries; commits README + CHANGELOG changes to the MR branch under a bot identity; writes wiki proposals to `.docs/wiki-staging/{manifest.yaml, pages/*.md}`; posts an MR comment summarizing all proposals. Re-running on the same MR must not clobber human edits to staged files, README, or CHANGELOG.
- **Post-merge wiki publisher** via `docwelder publish`, invoked by a CI job triggered on push to the default branch. Reads the staging manifest; for each entry, performs an ADO Wiki `PUT` with `If-Match: <source_etag>` on updates or a `PUT` on creates; on ETag mismatch or other failure, opens a GitLab issue and comments on the originating MR; on full success, commits removal of the staging tree with `[skip ci]`. Serialized via `resource_group`. Does not require an LLM credential.
- **Docwelder's own distribution** — publishing the versioned container image to a public registry, publishing a versioned GitLab CI include template at a stable URL that references the pinned image, and providing `docwelder upgrade` to bump the pinned include version in a repo's `.gitlab-ci.yml`. Version compatibility between image and template is Docwelder's responsibility, not the user's.

### MVP concrete choices

- Git host adapter: **GitLab** (self-hosted or gitlab.com).
- Wiki backend adapter: **Azure DevOps Wiki**.
- LLM provider adapter: **OpenRouter** (single credential fronts many models; model choice is user- and repo-configurable).
- CI integration: `docwelder init` writes a `.gitlab-ci.yml` using `include: - remote: <pinned-versioned-url>` referencing the Docwelder CI template. The template defines `docwelder-propose` and `docwelder-publish` jobs against a pinned container image tag and sets `GIT_DEPTH: "0"` on `docwelder-propose` so the merge base is reachable.
- Diff acquisition: local `git` only for MVP.

Adapter interfaces (`GitHost`, `WikiBackend`, `LLMProvider`) are a cross-cutting implementation concern that will be documented in this change's `design.md`, not a standalone capability.

### Repository artifacts introduced per onboarded repo

```
.docs/
  config.yaml            # style + verification rules (committed)
  mapping.yaml           # code path → wiki page mapping (committed)
  wiki-staging/          # transient, cleaned by publish job
    manifest.yaml
    pages/*.md
  .gitignore             # ignores wiki-staging/
.gitlab-ci.yml           # remote include of Docwelder CI template
CHANGELOG.md             # generated if missing
```

## Capabilities

### New Capabilities

- `user-config`: first-install, per-machine setup; owns the `docwelder init-user` command and the `~/.config/docwelder/config.yaml` file that stores wiki backend selection, wiki credentials, and LLM provider credentials.
- `repo-init`: per-repo initialization; owns the `docwelder init` command, README/CHANGELOG detection, wiki scan, explicit mapping proposal, artifact writes into `.docs/` and `.gitlab-ci.yml`, and the printed post-init instructions.
- `doc-style-config`: the schema and semantics of `.docs/config.yaml` — both deterministic structural rules enforced post-generation and soft style guidance injected into the LLM prompt — independent of who writes the file.
- `mr-proposal-pipeline`: MR-time proposal generation; owns the `docwelder propose` command, the CI job triggered on `merge_request_event`, diff computation, wiki fetch with ETag capture, LLM-driven proposal generation, structural validation with bounded retries, the bot's commit + push of README and CHANGELOG changes, the write of `.docs/wiki-staging/`, the MR summary comment, and the idempotency contract on re-runs.
- `wiki-publisher`: post-merge publication; owns the `docwelder publish` command, the CI job triggered on push to the default branch, the ETag-guarded ADO Wiki `PUT` per entry, conflict/error handling (GitLab issue + MR comment), and the `[skip ci]` cleanup commit.
- `distribution`: how Docwelder itself ships and evolves; owns the versioned container image published to a public registry, the versioned GitLab CI include template published at a stable URL, the image/template version-compatibility promise, and the `docwelder upgrade` command that bumps the pinned include version in a consuming repo.

### Modified Capabilities

None. This is a greenfield change; `openspec/specs/` is empty.

## Non-Goals

- Code-level docstrings, inline comments, and Architecture Decision Records.
- External marketing sites, product documentation portals, or non-wiki knowledge bases.
- Multi-git-host support in MVP (GitHub, Bitbucket deferred to a later change).
- Additional wiki backends in MVP (Confluence, GitHub Wiki, Notion deferred).
- Automatic conflict resolution when a wiki page has been edited externally between MR open and merge — Docwelder reports the conflict; humans resolve it.
- Semantic (AI-inferred) code-path → wiki-page mapping. MVP uses explicit mapping only.
- Air-gapped or restricted-egress GitLab environments where public container registries and remote CI includes are unreachable.
- Environments that mandate shallow git clones on CI pipelines; MVP requires `GIT_DEPTH: 0` on the propose job.
- Windows support for the local shim in MVP; Windows users may use `docker run` directly against the container image.
- README ↔ wiki contradiction as a verification rule. Codebase is the source of truth; wiki updates are proposed instead of README rewrites.

## Impact

**New repository artifacts per onboarded repo.** A committed `.docs/` directory (config, mapping, and a transient `wiki-staging/`) and a `.gitlab-ci.yml` (or CI include if the file already exists). A `CHANGELOG.md` is generated if none exists.

**New GitLab requirements per onboarded repo.**

- A bot user with Developer or Maintainer role and a project access token scoped to `api` + `write_repository`.
- CI/CD variables: `ADO_WIKI_PAT` (masked, protected), `GITLAB_BOT_TOKEN` (masked, protected), `OPENROUTER_API_KEY` (masked, protected).
- Ability to run pipeline jobs with `GIT_DEPTH: 0` on merge-request events.

**New per-user artifacts.** `~/.config/docwelder/config.yaml` containing wiki backend selection, ADO organization/project/wikiIdentifier, ADO PAT, and OpenRouter API key. Used by local `docwelder init`; never committed.

**New ADO Wiki requirements.** The bot identity behind `ADO_WIKI_PAT` must have Contribute permission on the target wiki.

**New external network dependencies from CI.** The GitLab instance hosting the remote CI include (at pipeline parse time), the public container registry hosting the Docwelder image, the ADO Wiki REST API (used by both propose and publish), and the OpenRouter API (used by propose only). The publish job does not depend on OpenRouter and remains functional if OpenRouter is unavailable or the key rotates.

**New public artifacts the Docwelder project must maintain.** A versioned container image on a public registry, a versioned GitLab CI include template at a stable URL, and a POSIX-shell install script at a stable HTTPS URL that installs a local wrapper for developer machines. Version compatibility between the container image and the CI template is Docwelder's responsibility, not the user's.

**New per-user prerequisites.** A supported container runtime (Docker or Podman) installed on every machine that runs local `docwelder` commands (`init-user`, `init`, `upgrade`, `self-update`).

## Open Questions

Deferred to this change's design and tasks artifacts.

1. Retry limit and backoff strategy for LLM validation retries in `docwelder propose`, and per-MR cost/token budget guardrails.
2. Default OpenRouter model to ship in the container image, and the exact mechanism for per-repo override (`llm.model:` field in `.docs/config.yaml`).
3. Bot user naming convention and whether the bot identity is created per-repo or per-group.
4. Feedback-loop prevention for bot commits: `[skip ci]` marker on bot commits vs. a CI rule excluding the bot author. Both work; pick one.
5. Handling of wiki pages renamed or moved by editors outside Docwelder — MVP requires manual `.docs/mapping.yaml` update; document a detection heuristic for later.
6. ADO Wiki attachment support in MVP (default position: no).
7. Exact schemas for `.docs/config.yaml` and `.docs/mapping.yaml`, including validation rules and forward-compatibility strategy.
8. AI prompt templates for generation and structural validation, including how validator errors are re-injected on retry.
9. `docwelder upgrade` UX — auto-open an MR bumping the pinned include version, or print instructions.
10. Which public registry hosts the container image (Docker Hub, GHCR, or gitlab.com registry) and the corresponding CI include host.
11. Fallback path for organizations that mandate shallow clones — whether to ship a `--diff-source=api` mode in a later change that uses GitLab's Merge Request Changes API instead of local `git diff`.
12. Whether the install script and the CI include template share a URL prefix or live at separate hosts.
13. Whether `docwelder self-update` accepts arbitrary version pins or only versions from a signed release feed.
