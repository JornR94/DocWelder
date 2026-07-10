## Context

Docwelder is a new, standalone tool. There is no existing codebase to accommodate. The proposal commits us to six user-facing capabilities that together deliver a semi-automated doc-sync loop across GitLab, Azure DevOps Wiki, and OpenRouter, with an explicit ambition to be tool-agnostic post-MVP.

The design surface is unusually wide because a single change ships:

- a container image and its runtime,
- a GitLab CI template published at a stable URL,
- three integration adapters (git host, wiki backend, LLM provider),
- a two-job pipeline (propose on MR, publish on push to default branch),
- persisted config at two scopes (user and repo),
- a review UX layered on top of a normal GitLab MR.

The most consequential cross-cutting decisions are: how Docwelder is distributed and versioned; how the pipeline gets its inputs; how concurrent MRs and external wiki edits are reconciled; how LLM output is validated; and how the tool stays extensible to future git hosts and wiki backends without forcing a rewrite.

## Goals / Non-Goals

**Goals:**

- One tool, one container, one CI template — no plugin registry, no server component, no persistent service to operate.
- Reviewable output: every proposed change surfaces in the MR the developer is already looking at.
- Codebase as source of truth: never propose changes to code from a doc mismatch; propose doc changes to match the code.
- Pluggable at the seams that matter (git host, wiki backend, LLM provider) so adding GitHub or Confluence later is a new adapter, not a rewrite.
- Safe by default at the wiki boundary: never silently overwrite an external edit.
- Idempotent re-runs: pushing new commits on an MR must not stomp prior human edits to bot-authored files.

**Non-Goals:**

- A UI beyond the terminal for `init` and the MR itself.
- A persistent Docwelder service, database, or queue.
- Fine-grained per-file model routing, or a plugin ecosystem for user-defined validators.
- Any behavior that requires modifying a running GitLab instance (webhooks, apps, integrations). The tool is entirely repo-side.
- Handling doc changes that don't originate from a git diff (e.g., "please update the wiki because our team renamed itself").

## Decisions

### D1. Distribution: container image + remote CI include, both versioned in lockstep

`docwelder init` writes a `.gitlab-ci.yml` with a single `include: - remote: <pinned-versioned-url>` pointing at a Docwelder-maintained YAML template. The template pins the same version of the container image via its `image:` field.

Chosen over:

- **GitLab CI/CD Catalog component.** Idiomatic on gitlab.com but adds friction on self-hosted instances and constrains us to GitLab's catalog lifecycle. We keep it in reserve as a second distribution channel that references the same template file.
- **Inline job definitions in each repo's `.gitlab-ci.yml`.** Self-contained and auditable but forces every repo to re-run `init` on every upgrade. Kept in reserve as a `--vendor` mode for constrained orgs.

Consequence: Docwelder is responsible for a version-compatibility contract between the image tag and the CI template tag. The contract is: template `vX.Y.Z` references image `vX.Y.Z`, one to one. `docwelder upgrade` bumps both by bumping the URL.

The CI include is the pipeline-side distribution channel; a local POSIX-shell shim installed via `curl | sh` is the developer-machine counterpart. The shim wraps `docker run` (or `podman run`) with the mounts, TTY, and environment forwarding a `docwelder` command needs, so users type `docwelder <cmd>` on their machine and never `docker run` directly. Both channels pin the same image tag; `docwelder self-update` updates the pinned image tag in the local shim, mirroring what `docwelder upgrade` does for a repo's CI include.

### D2. Adapter architecture: three interfaces, one MVP implementation each

Three interfaces sit between the Docwelder core and the outside world:

- `GitHost` — clone/diff, comment on MR, push commits, open issue. MVP impl: GitLab.
- `WikiBackend` — list, fetch (with ETag), create, update (with `If-Match`). MVP impl: ADO Wiki.
- `LLMProvider` — chat completion with structured-output contract, streaming optional. MVP impl: OpenRouter.

Adapter selection is config-driven, not compile-time. `~/.config/docwelder/config.yaml` (for local `init`) and CI variables (for pipeline jobs) name the adapter and provide its credentials.

Chosen over:

- **Hardcoded integrations.** Faster for MVP but poisons the codebase against the tool-agnostic goal; every new git host or wiki would touch the core.
- **Full plugin loading (dynamic modules).** Overkill for three interfaces with a small implementation count. Static registration inside the container is sufficient.

Consequence: adapter interfaces are the tool's public contract for future extension. They will be documented in code alongside their MVP implementations; they are not their own capability spec.

### D3. Diff acquisition: local `git` with `GIT_DEPTH: 0`

The CI template sets `GIT_DEPTH: "0"` on the `docwelder-propose` job and Docwelder runs `git diff $CI_MERGE_REQUEST_DIFF_BASE_SHA...HEAD`. The container image bundles `git`.

Chosen over:

- **GitLab Merge Request Changes API.** Works with shallow clones and returns structured hunks, but doubles the "what changed" code paths and hits the GitLab API from every propose run. Kept in reserve for a future `--diff-source=api` mode covering orgs that mandate shallow clones.

Consequence: MVP is not usable in orgs that cap `GIT_DEPTH` via runner policy. Called out in Non-Goals.

### D4. Wiki concurrency: ETag optimistic locking + `resource_group` serialization on publish

Two independent guards:

- **ETag optimistic lock, per page.** `docwelder propose` captures the `ETag` header per page at fetch time and stores it in `manifest.yaml` as `source_etag`. `docwelder publish` sends `If-Match: <source_etag>` on the `PUT`. Mismatch aborts that entry and opens a GitLab issue + MR comment naming the affected page.
- **`resource_group: docwelder-publish` on the publish job.** Serializes concurrent publish runs from parallel merges to the default branch, eliminating a race between the `GET`-for-ETag-check and the `PUT` that follows.

Chosen over:

- **A pessimistic lock (wiki-side).** ADO Wiki does not expose one; would require a side channel.
- **A queue or reconciliation daemon.** Reintroduces the persistent service we specifically want to avoid.

Consequence: two MRs staging changes to the same wiki page will succeed in the first-to-merge and fail in the second-to-merge with a clear "wiki changed under you, re-run propose" surface. That's the correct behavior; no automatic conflict resolution.

### D5. Staging lives in the MR branch as `.docs/wiki-staging/`

Wiki proposals are committed to the MR branch as plain markdown files under `.docs/wiki-staging/pages/` plus a `manifest.yaml`. The publish job reads and then removes them.

Chosen over:

- **GitLab CI artifacts.** Ephemeral by design; require the publish job to correlate against the source MR after merge; not reviewable in the MR diff view.
- **External object store (S3, etc.).** Adds a dependency and a credential; makes the review UX indirect.
- **A comment-thread-only representation.** Not editable via normal MR review flow; can't be diffed on subsequent pushes.

Consequences: the MR branch grows a `.docs/wiki-staging/` tree during review. That tree is cleaned by the publish job on merge with a `[skip ci]` commit. `.docs/.gitignore` deliberately does *not* ignore `wiki-staging/` — the whole point is that it appears in the diff.

### D6. Two-tier configuration: credentials at user level, behavior at repo level

- `~/.config/docwelder/config.yaml` holds identity and secrets used by local `docwelder init` (wiki backend selection, ADO org/project/wiki/PAT, OpenRouter API key, per-user LLM model override).
- `.docs/config.yaml` holds committed, team-owned behavior (structural rules, style guidance, update triggers, exclusions, repo-level LLM model override).

CI pipeline runs receive credentials via CI variables, not via any file. There is no runtime path that reads a user config file inside CI.

Chosen over:

- **A single unified config file.** Either commits secrets or leaves behavior in a user-scoped file the team can't share.
- **Repo-level secrets in `.docs/`.** Trivially leaked in forks and unreviewed contributions.

### D7. LLM output is validated deterministically and re-prompted on failure, with a hard cap

`docwelder propose` runs the LLM once, then runs the structural validator suite (required sections, max word counts, heading depth, code-block language whitelist, Keep-a-Changelog format) on the output. On any validator failure, it re-prompts the LLM with the validator errors and the current output, bounded by a hard retry limit `N`. On exhaustion, the job fails non-blockingly (exit code so the MR does not block merge) and the bot comments with the last set of validator errors.

Chosen over:

- **Trusting the first LLM output.** Producing structurally-wrong output is common enough to warrant explicit correction.
- **A validation-only pass with human resolution.** Defeats the point of automation for the common case.

Open sub-decisions: exact value of `N`, backoff, and per-MR token/dollar cap. Listed in Open Questions.

### D8. Idempotent re-runs on the same MR

On every propose run, Docwelder inspects the current state of the MR branch — README, CHANGELOG, and `.docs/wiki-staging/` — and treats it as ground truth for anything a human has touched since the last bot commit. Detection is by commit authorship (anything not authored by the bot identity) and by content diff against the bot's last known output (stored under `.docs/wiki-staging/.docwelder-state.json`, a small marker file listing per-artifact SHAs of prior bot output).

On rerun:

- Files whose current SHA matches the last bot SHA are eligible for regeneration.
- Files whose current SHA differs from the last bot SHA are treated as human-edited and left alone; the MR comment notes them as "kept human edits."
- New diff since the last run may still add new staged pages or new README sections; those are appended, never overwriting existing human content.

Chosen over:

- **Always regenerate.** Erases review edits.
- **Never regenerate after first run.** Stales the doc proposal as code keeps changing.

### D9. Feedback-loop prevention: bot commits carry `[skip ci]`

Every commit authored by the bot in either job (propose's README/CHANGELOG/staging commit, publish's cleanup commit) includes `[skip ci]` in the trailer. This is a two-line rule set inside Docwelder rather than a CI rule that repo owners must maintain.

Chosen over:

- **CI rule excluding the bot author.** Requires every repo's `.gitlab-ci.yml` to know the bot's username, which drifts and breaks silently when bots are renamed.

### D10. Explicit mapping only for MVP; hybrid mapping is post-MVP

`.docs/mapping.yaml` is authored by the user (with an AI-proposed first draft at `init` time) and never mutated by the pipeline. Semantic matching between code paths and wiki pages is a post-MVP capability.

Chosen over:

- **Hybrid mapping in MVP.** Doubles the surface area of `mr-proposal-pipeline`, adds a second failure mode (wrong page selected), and makes the review UX ambiguous ("why did the bot touch *that* page?").

### D11. Cross-run state lives only in the repo or the wiki backend

Docwelder holds no state outside two durable stores: the repository (via bot commits) and the wiki backend itself. CI runner disks, GitLab `cache:` blocks, and container-image local storage are treated as untrusted and ephemeral. Every CI job starts a fresh container with only the standard image layers, the checked-out repository, and the CI environment; nothing carries over from a previous run except what is committed to git.

Consequence: the idempotent-rerun state marker (D8), the wiki proposal staging (D5), and the captured ETags (D4) are all forms of the same pattern — persist in git, read from git, mutate through bot commits. This is why the CI template forbids `cache:` (codified in the `distribution` spec) and why `propose` and `publish` do not read `~/.config/docwelder/` (codified in the `user-config` spec).

Chosen over:

- **Runner-side caching (GitLab `cache:`).** Silently fails when caches are evicted, when a job runs on a fresh runner, or when a branch is deleted. Makes reasoning about failure modes intractable.
- **External state stores (Redis, S3, etc.).** Reintroduces operational surface — a service to run, credentials to manage, an availability dependency on the critical path — that we specifically want to avoid.
- **A Docwelder-owned server.** Same objections as external state stores, plus makes Docwelder a service the user must trust with their code, docs, and secrets.

## Risks / Trade-offs

- **LLM cost per MR is unbounded without a guard.** → Add a per-MR token budget in `.docs/config.yaml` with a sane default; propose job fails non-blockingly when the budget is exhausted. Exact default deferred to Open Questions.
- **LLM hallucinates a section or a flag that does not exist.** → Structural validators catch shape errors but not semantic hallucination. Mitigation: validators include "referenced files must exist" and "documented CLI flags must appear in code" checks (already in-scope as README verification rules from Feature 2). Anything the validators cannot catch is caught by human MR review, which is the whole model.
- **ADO Wiki API rate limits during a burst of merges.** → `resource_group` on publish naturally serializes; a simple retry-with-backoff on 429 is sufficient for MVP.
- **External wiki edit between MR open and merge.** → ETag mismatch aborts the entry with a GitLab issue; user re-runs propose on the affected MR to pick up the newer content. This is by design (see D4), not a bug.
- **Bot infinite loop despite `[skip ci]`.** → Belt-and-braces: `mr-proposal-pipeline` also detects that the branch's HEAD commit is authored by the bot with no non-bot commits since last run, and exits early.
- **Wiki page renamed externally.** → MVP has no detection; `docwelder publish` will `create` at the mapped path. Documented workaround: edit `.docs/mapping.yaml`. Detection heuristic deferred to Open Questions.
- **OpenRouter degradation or model deprecation.** → `LLMProvider` abstraction contains the blast radius; per-repo model override in `.docs/config.yaml` allows teams to pin or migrate. Publish job does not depend on OpenRouter, so wiki syncs still work during LLM outages.
- **Container registry unavailability.** → CI job fails at image pull. This is standard CI risk; not Docwelder-specific.
- **Prompt injection via committed code or docs.** → The LLM sees diff content and current doc content, both of which come from the repo. Malicious content can attempt to redirect the model. Mitigation: system prompt is fixed inside the container image; the validator suite constrains output shape; the human-in-the-loop MR review is the final gate. Acceptable for MVP.
- **Version drift between container image and CI template.** → D1 pins them one-to-one via URL; `docwelder upgrade` bumps both atomically. Manually editing one without the other is user error and is documented.
- **Assuming runner-side caching would work.** → Docwelder deliberately declares no `cache:` in the CI template (codified in the `distribution` spec) and treats every CI job as stateless; all cross-run state lives in git or in the wiki backend per D11.

## Migration Plan

This is a greenfield tool with no existing users. There is no data or config to migrate. Adoption is per-repo via `docwelder init`, which is idempotent and safe to re-run.

Rollback for an onboarded repo: remove `.docs/`, revert the `.gitlab-ci.yml` changes, revoke the bot user and its access token. The wiki pages Docwelder previously published remain in place; they are not deleted.

Rollout ordering across capabilities is enforced by the `tasks.md` artifact — adapters first (so the pipeline capabilities have something to call), then user-config, then repo-init, then the two pipeline capabilities, then distribution wiring. That's implementation ordering, not user-facing ordering.

## Open Questions

Design-level, to be resolved during implementation planning in `tasks.md` or during first cut:

1. Concrete value for LLM retry cap `N`, backoff strategy, and default per-MR token/dollar budget.
2. Default OpenRouter model shipped in the container image; a per-repo override key name (`llm.model`) is settled; the value default is not.
3. Bot user naming convention (per-repo `docwelder-bot-<repo>` vs. per-group `docwelder-bot`), and the guidance we print in `init`'s post-setup instructions.
4. Wiki-page rename detection heuristic (fuzzy path match on 404 during publish? Wiki-side page listing at propose time?) — the MVP behavior is documented (manual mapping edit) but the future heuristic is undecided.
5. Container base image and language runtime (Python, Node, Go). Python is the pragmatic choice for LLM ecosystem maturity and CLI ergonomics; final decision blocks `tasks.md`.
6. Prompt template versioning: prompts live in the container image; whether they are user-overridable via `.docs/config.yaml` for MVP (default position: no, to keep validation contracts stable).
7. Which public container registry hosts the image (Docker Hub, GHCR, gitlab.com registry) and which git host serves the CI include URL. Both must be publicly reachable; the pair should be picked together.
8. Whether `docwelder upgrade` opens an MR (requires `write_repository` on the bot at upgrade time from the developer's machine) or prints a diff for the developer to commit manually.
