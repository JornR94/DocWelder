## 1. Project scaffolding and shared foundations

- [ ] 1.1 Decide language/runtime for the CLI (per design Open Question #5) and record the choice in this tasks file
- [ ] 1.2 Initialize the repository layout: source tree, tests tree, `Dockerfile`, `release/` for the CI template and install script, and a top-level `README` describing the project
- [ ] 1.3 Pick and configure a linter, formatter, and test runner appropriate to the chosen language
- [ ] 1.4 Set up the project's own CI (build, lint, test on every PR)
- [ ] 1.5 Add a version constant sourced from a single file so image tag, CI template URL, and wrapper pin all read from one place
- [ ] 1.6 Define the CLI command dispatcher scaffold with subcommands `init-user`, `init`, `propose`, `publish`, `upgrade`, `self-update`, `--version`
- [ ] 1.7 Add a structured logging module used by every command with severity levels and machine-parseable JSON output option

## 2. Adapter interfaces

- [ ] 2.1 Define the `GitHost` interface (clone/diff helpers, comment on MR, push commits with token, open issue, list authors on a range of commits)
- [ ] 2.2 Define the `WikiBackend` interface (list pages by name/path/keyword, get page with ETag, create page, update page with `If-Match`)
- [ ] 2.3 Define the `LLMProvider` interface (chat completion with structured output contract, model selection, error/timeout surface)
- [ ] 2.4 Add adapter registry with config-driven selection (name + credential source)
- [ ] 2.5 Write unit tests for the registry covering unknown-adapter and missing-credential paths

## 3. GitLab adapter (`GitHost` implementation)

- [ ] 3.1 Implement `git diff $CI_MERGE_REQUEST_DIFF_BASE_SHA...HEAD` runner with actionable error when base is unreachable
- [ ] 3.2 Implement author lookup on a commit range for idempotency detection (spec `mr-proposal-pipeline`, Requirement: Idempotent re-runs preserve human edits)
- [ ] 3.3 Implement bot commit + push using `oauth2:${GITLAB_BOT_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git`
- [ ] 3.4 Implement MR comment posting via `POST /projects/:id/merge_requests/:iid/notes`
- [ ] 3.5 Implement issue opening via `POST /projects/:id/issues`
- [ ] 3.6 Add `[skip ci]` trailer to every bot commit produced by this adapter (spec `mr-proposal-pipeline`, Requirement: Bot commits skip CI)
- [ ] 3.7 Add integration tests against a disposable GitLab test project (or a recorded HTTP fixture layer)

## 4. Azure DevOps Wiki adapter (`WikiBackend` implementation)

- [ ] 4.1 Implement page listing with fuzzy match by name, path segments, and keywords for use by `docwelder init`
- [ ] 4.2 Implement `GET` of a page returning content and `ETag`
- [ ] 4.3 Implement `PUT` for create at a nested path relying on ADO auto-parent-creation
- [ ] 4.4 Implement `PUT` for update with `If-Match` header and distinct error surface on 412 Precondition Failed
- [ ] 4.5 Add retry-with-backoff on 429 responses
- [ ] 4.6 Add integration tests against a disposable ADO test wiki (or recorded fixtures)

## 5. OpenRouter adapter (`LLMProvider` implementation)

- [ ] 5.1 Implement chat completion call against OpenRouter with model selected from image default or `.docs/config.yaml` `llm.model` override
- [ ] 5.2 Define the structured output contract used by `propose` (README patch, CHANGELOG entry with Keep-a-Changelog category, list of wiki updates/creates)
- [ ] 5.3 Add re-prompt helper that carries prior draft + validator errors back to the model
- [ ] 5.4 Add per-call timeout, retry cap, and token-budget accounting hooks
- [ ] 5.5 Add unit tests with recorded fixtures for a happy path, a validator-retry path, and a budget-exhausted path

## 6. `.docs/config.yaml` schema and loader (spec: `doc-style-config`)

- [ ] 6.1 Define the structural rules schema (required README sections, max word count per section, heading depth limit default 4, code-block language whitelist, CHANGELOG format identifier defaulting to `keep-a-changelog`)
- [ ] 6.2 Define the style guidance schema (tone, audience, conciseness intent, code-example policy, diagram policy, README ↔ wiki policy, update triggers, exclusions)
- [ ] 6.3 Define the `llm.model` override field
- [ ] 6.4 Implement schema validation that fails fast with file path, line number when available, and offending field
- [ ] 6.5 Implement default resolution when fields are omitted
- [ ] 6.6 Write unit tests: valid config, malformed YAML, unknown field, missing optional field
- [ ] 6.7 Add a documented example `.docs/config.yaml` matching the opinionated defaults

## 7. `.docs/mapping.yaml` schema and loader

- [ ] 7.1 Define the mapping schema (code path glob → wiki path)
- [ ] 7.2 Implement loader with the same fail-fast validation as `config.yaml`
- [ ] 7.3 Write unit tests covering valid mapping, invalid glob, and duplicate path

## 8. `user-config` capability

- [ ] 8.1 Implement `docwelder init-user` command with interactive prompts (spec: `user-config`)
- [ ] 8.2 Persist to `~/.config/docwelder/config.yaml` with mode `0600` on POSIX
- [ ] 8.3 On re-run, show current values with secrets masked and require per-field confirmation
- [ ] 8.4 Enforce that CI commands (`propose`, `publish`) do not open the user config file
- [ ] 8.5 Add a lint check in the CLI startup that emits a warning if `~/.config/docwelder/config.yaml` is world-readable
- [ ] 8.6 Write end-to-end tests covering fresh install, re-run, and CI-context isolation

## 9. `repo-init` capability

- [ ] 9.1 Implement the `docwelder init` command entry point with prerequisites check (spec: `repo-init`)
- [ ] 9.2 Implement the setup-mode single-question prompt
- [ ] 9.3 Implement the advanced-mode 5-question flow with derivations to `.docs/config.yaml`
- [ ] 9.4 Implement README detection and the four verification rules (broken refs, outdated CLI, stale installation, missing coverage)
- [ ] 9.5 Implement README generation from codebase analysis when the file is missing
- [ ] 9.6 Implement CHANGELOG detection and Keep-a-Changelog generation from git history when missing
- [ ] 9.7 Implement wiki scan using the `WikiBackend` list operation
- [ ] 9.8 Implement AI-proposed mapping generation and user prompt (accept / edit in `$EDITOR` / reject)
- [ ] 9.9 Implement artifact writes: `.docs/config.yaml`, `.docs/mapping.yaml`, `.docs/.gitignore`, `.gitlab-ci.yml`
- [ ] 9.10 Implement append-mode for existing `.gitlab-ci.yml` that inserts the remote include without disturbing existing job definitions
- [ ] 9.11 Implement the post-init instructions printer (bot user, CI variables, wiki permissions)
- [ ] 9.12 Implement re-run idempotency guard that detects `.docs/config.yaml` and prompts before modifying anything
- [ ] 9.13 Write end-to-end tests: clean repo, repo with existing CI file, repo with existing README/CHANGELOG, re-run

## 10. `mr-proposal-pipeline` capability

- [ ] 10.1 Implement `docwelder propose` command entry point with `CI_PIPELINE_SOURCE` gate (spec: `mr-proposal-pipeline`)
- [ ] 10.2 Load `.docs/config.yaml` and `.docs/mapping.yaml`, aborting with actionable error if missing or invalid
- [ ] 10.3 Compute diff via `GitHost` and abort cleanly if the base SHA is unreachable
- [ ] 10.4 Fetch every mapped wiki page and capture ETag per page
- [ ] 10.5 Build the LLM prompt from diff + current README + current CHANGELOG + wiki snapshots + style guidance
- [ ] 10.6 Implement structural validation suite (required sections, max word count, heading depth, code-block language, Keep-a-Changelog format, referenced files exist, documented CLI flags exist in code)
- [ ] 10.7 Implement bounded-retry loop that re-prompts with validator errors
- [ ] 10.8 On retry exhaustion, exit non-blockingly and post an MR comment with the final validator errors
- [ ] 10.9 Implement the idempotency scanner using the `.docwelder-state.json` marker (design D8) to detect human-edited files by SHA and by non-bot authorship
- [ ] 10.10 Implement the recursion guard that exits early when HEAD is bot-authored with no non-bot commits since last regeneration
- [ ] 10.11 Write README and CHANGELOG changes into the working tree
- [ ] 10.12 Write `.docs/wiki-staging/manifest.yaml` and `pages/*.md`
- [ ] 10.13 Update `.docs/wiki-staging/.docwelder-state.json` with per-artifact SHAs of the latest bot output
- [ ] 10.14 Commit and push all changes under the bot identity with `[skip ci]`
- [ ] 10.15 Post the MR summary comment listing README, CHANGELOG, and wiki changes; include a "kept human edits" section when applicable
- [ ] 10.16 Implement the no-op path with its distinct MR comment when the diff contains no changes matching any configured update trigger
- [ ] 10.17 Add end-to-end tests: first run happy path, retry-then-success, retry-exhausted, re-run with human edit to README, re-run with human edit to staged wiki file, no-op diff, missing `OPENROUTER_API_KEY`, missing `GITLAB_BOT_TOKEN`
- [ ] 10.18 Verify state file lifecycle end-to-end: `.docs/wiki-staging/.docwelder-state.json` is read from checkout at job start, written in the same bot commit as artifacts, and present in the fresh container on a subsequent job after checkout

## 11. `wiki-publisher` capability

- [ ] 11.1 Implement `docwelder publish` command entry point with `CI_COMMIT_BRANCH == CI_DEFAULT_BRANCH` gate (spec: `wiki-publisher`)
- [ ] 11.2 Detect `.docs/wiki-staging/manifest.yaml` and treat absence as a successful no-op
- [ ] 11.3 Iterate manifest entries; for updates, refetch, compare ETag, `PUT` with `If-Match` on match, record conflict on mismatch
- [ ] 11.4 For creates, `PUT` to `wiki_path`
- [ ] 11.5 Continue processing remaining entries after any single-entry failure and record all per-entry results
- [ ] 11.6 On any failure, open a GitLab issue naming failing paths and reasons and post an MR comment on the originating MR referencing the issue
- [ ] 11.7 On full success only, commit the deletion of `.docs/wiki-staging/` with `[skip ci]`
- [ ] 11.8 Ensure no code path opens an LLM connection or requires `OPENROUTER_API_KEY`
- [ ] 11.9 Add end-to-end tests: happy path, ETag mismatch on one entry, ADO 5xx on one entry, no manifest present, missing `ADO_WIKI_PAT`

## 12. `distribution` capability — container image

- [ ] 12.1 Author the `Dockerfile` producing a minimal image with `git` and the Docwelder CLI installed on the chosen runtime
- [ ] 12.2 Add build script that stamps the image with `MAJOR.MINOR.PATCH` from the single version source
- [ ] 12.3 Publish image to the chosen public registry from the project's release pipeline (registry choice per Open Question #10; record decision here)
- [ ] 12.4 Add image-startup version check that reads the CI template version and refuses to run when it does not match the image version
- [ ] 12.5 Test image locally with `docker run docwelder/cli:<v> --version`

## 13. `distribution` capability — CI include template

- [ ] 13.1 Author the CI template YAML with `docwelder-propose` and `docwelder-publish` jobs
- [ ] 13.2 Set `image: <registry>/docwelder/cli:<version>` on both jobs, using the shared version
- [ ] 13.3 Set `GIT_DEPTH: "0"` on `docwelder-propose`
- [ ] 13.4 Set `resource_group: docwelder-publish` on `docwelder-publish`
- [ ] 13.5 Set `rules:` to gate propose on `$CI_PIPELINE_SOURCE == "merge_request_event"` and publish on `$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`
- [ ] 13.6 Publish the template at the versioned URL from the project's release pipeline
- [ ] 13.7 Add a smoke test in the project's own CI that fetches the template at the just-published URL and parses it

## 14. `distribution` capability — local shim and install script

- [ ] 14.1 Author the POSIX-shell install script (`install.sh`) targeting bash and zsh on macOS and Linux
- [ ] 14.2 Detect Docker or Podman on `PATH`; exit non-zero with actionable error when neither is present
- [ ] 14.3 Refuse to install on Windows shells with a message pointing to the `docker run` fallback documentation
- [ ] 14.4 Install the `docwelder` wrapper to `~/.local/bin` (fallback `/usr/local/bin`) with the pinned image tag baked in
- [ ] 14.5 Implement the wrapper: `docker run -it` with user-config bind mount for every command
- [ ] 14.6 Implement the wrapper: CWD bind mount and `-w /workspace` for `init` and `upgrade` only; no CWD mount for `init-user`
- [ ] 14.7 Implement the wrapper: forward `EDITOR` env var
- [ ] 14.8 Implement the wrapper: first-use image pull with progress; cached reuse on subsequent invocations
- [ ] 14.9 Implement `docwelder --version` in the wrapper reporting wrapper version and pinned image tag
- [ ] 14.10 Implement `docwelder self-update` that rewrites the wrapper's pinned image tag
- [ ] 14.11 Publish `install.sh` at a stable HTTPS URL from the release pipeline
- [ ] 14.12 Write shell tests exercising the install path on macOS and Linux runners; assert wrapper is on PATH and reports the correct pinned version

## 15. `distribution` capability — upgrade command in repos

- [ ] 15.1 Implement `docwelder upgrade` command that reads the current pinned version from `.gitlab-ci.yml`
- [ ] 15.2 Query the release feed for the latest available version
- [ ] 15.3 Rewrite the `include: - remote:` URL to the newer version and report the delta
- [ ] 15.4 Exit zero with "no upgrade needed" when already latest
- [ ] 15.5 Write end-to-end tests: outdated repo, up-to-date repo, malformed CI file

## 16. Cross-cutting concerns

- [ ] 16.1 Resolve design Open Question #1 (retry cap `N`, backoff, per-MR token/dollar budget) and implement chosen defaults; expose per-MR budget in `.docs/config.yaml`
- [ ] 16.2 Resolve design Open Question #2 (default OpenRouter model) and set it in the image
- [ ] 16.3 Resolve design Open Question #3 (bot naming convention) and update `repo-init` post-install instructions
- [ ] 16.4 Resolve design Open Question #5 (container base image and language runtime) — should be resolved by task 1.1
- [ ] 16.5 Resolve design Open Question #7 (registry host) — should be resolved by task 12.3
- [ ] 16.6 Resolve design Open Question #8 (`docwelder upgrade` UX: auto-MR vs. print diff)
- [ ] 16.7 Resolve proposal Open Question #12 (install script vs. CI template URL prefix)
- [ ] 16.8 Resolve proposal Open Question #13 (`docwelder self-update` version-feed signing)

## 17. Documentation

- [ ] 17.1 Write the project `README` covering install-script one-liner, first-machine setup, per-repo onboarding walk-through, and troubleshooting
- [ ] 17.2 Write the `docker run` fallback documentation for Windows users
- [ ] 17.3 Document the version-compatibility promise between image and CI template
- [ ] 17.4 Document how to add a new `GitHost`, `WikiBackend`, or `LLMProvider` adapter
- [ ] 17.5 Publish documentation from the release pipeline

## 18. Release wiring

- [ ] 18.1 Wire the project's own CI to build image + CI template + install script on every version tag
- [ ] 18.2 Wire the project's own CI to run the shell install tests and the smoke test that fetches the just-published CI template URL
- [ ] 18.3 Publish an announcement checklist for every MAJOR release covering the version-compatibility promise

## 19. End-to-end verification

- [ ] 19.1 Stand up a disposable GitLab project and ADO Wiki wiki as the fixture environment
- [ ] 19.2 Run `docwelder init-user` on a fresh machine and confirm `~/.config/docwelder/config.yaml`
- [ ] 19.3 Run `docwelder init` on the fixture repo and confirm all artifacts
- [ ] 19.4 Open an MR with a real code change; confirm bot commits appear, staging files appear, and MR comment appears
- [ ] 19.5 Merge and confirm wiki pages are updated and staging is cleaned
- [ ] 19.6 Introduce an external wiki edit mid-MR; confirm ETag conflict opens a GitLab issue and MR comment
- [ ] 19.7 Run `docwelder upgrade` after publishing a new version; confirm `.gitlab-ci.yml` is rewritten
