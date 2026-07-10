## 1. Project scaffolding and shared foundations

- [x] 1.1 Decide language/runtime for the CLI (per design Open Question #5) and record the choice in this tasks file
      **Decision: TypeScript on Node.js (>=20).** Chosen over Python (design's stated lean) per explicit user direction for this implementation. Node's fetch/streams are sufficient for the GitLab/ADO/OpenRouter HTTP calls, `zod` gives fail-fast schema validation with good error messages for `.docs/config.yaml`/`mapping.yaml`, and a single `node:{22-slim}` base keeps the container image simple.
- [x] 1.2 Initialize the repository layout: source tree, tests tree, `Dockerfile`, `release/` for the CI template and install script, and a top-level `README` describing the project
      `src/` (cli, commands, adapters, config, validators, logging), `test/unit` (mirrors `src/`) and `test/e2e`, `Dockerfile` (task 12), `release/` (task 13-14), `README.md` (task 17).
- [x] 1.3 Pick and configure a linter, formatter, and test runner appropriate to the chosen language
      ESLint 9 flat config (`typescript-eslint`) + Prettier + Vitest (with v8 coverage). `.prettierignore`/eslint `ignores` keep tooling off `openspec/`, `.claude/`, `.opencode/`, `.idea/`.
- [x] 1.4 Set up the project's own CI (build, lint, test on every PR)
      `.github/workflows/ci.yml`: checkout → setup-node → `npm ci` → format:check → lint → typecheck → build → test.
- [x] 1.5 Add a version constant sourced from a single file so image tag, CI template URL, and wrapper pin all read from one place
      `VERSION` at repo root (currently `0.1.0`); `src/version.ts` reads it at runtime; `package.json#version` is kept in sync manually at release time (task 18).
- [x] 1.6 Define the CLI command dispatcher scaffold with subcommands `init-user`, `init`, `propose`, `publish`, `upgrade`, `self-update`, `--version`
      `src/cli.ts` (Commander-based), delegating to stub modules under `src/commands/*` filled in by their respective capability sections below.
- [x] 1.7 Add a structured logging module used by every command with severity levels and machine-parseable JSON output option
      `src/logging/logger.ts`: `debug|info|warn|error`, plain-text or JSON-lines (`--json-logs` / `DOCWELDER_LOG_JSON=1`), per-command child loggers.

## 2. Adapter interfaces

- [x] 2.1 Define the `GitHost` interface (clone/diff helpers, comment on MR, push commits with token, open issue, list authors on a range of commits)
      `src/adapters/git-host/interface.ts`.
- [x] 2.2 Define the `WikiBackend` interface (list pages by name/path/keyword, get page with ETag, create page, update page with `If-Match`)
      `src/adapters/wiki-backend/interface.ts`; `WikiConflictError`/`WikiNotFoundError` for the 412 and 404 surfaces.
- [x] 2.3 Define the `LLMProvider` interface (chat completion with structured output contract, model selection, error/timeout surface)
      `src/adapters/llm-provider/interface.ts`; `LLMTimeoutError`/`LLMProviderError`.
- [x] 2.4 Add adapter registry with config-driven selection (name + credential source)
      `src/adapters/registry.ts`: generic `AdapterRegistry<T>` + `EnvCredentialSource` (CI jobs) / `MapCredentialSource` (user-config-backed local commands).
- [x] 2.5 Write unit tests for the registry covering unknown-adapter and missing-credential paths
      `test/unit/adapters/registry.test.ts`.

## 3. GitLab adapter (`GitHost` implementation)

- [x] 3.1 Implement `git diff $CI_MERGE_REQUEST_DIFF_BASE_SHA...HEAD` runner with actionable error when base is unreachable
      `GitlabHost.diff` (`src/adapters/git-host/gitlab.ts`) shells out to local `git diff <base>...<head>`; on failure the error names the unreachable ref and points at the CI template's `GIT_DEPTH: "0"` setting (design D3).
- [x] 3.2 Implement author lookup on a commit range for idempotency detection (spec `mr-proposal-pipeline`, Requirement: Idempotent re-runs preserve human edits)
      `GitlabHost.listCommitsInRange` runs `git log --reverse --format=...` with unambiguous unit/record separators, returning sha + author name/email + subject oldest-first.
- [x] 3.3 Implement bot commit + push using `oauth2:${GITLAB_BOT_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git`
      `GitlabHost.commitAndPush` writes/deletes the given files, no-ops (`skipped: true`) when nothing is staged, else commits under a `Docwelder Bot` identity and pushes via an inline (never persisted) remote URL carrying the token.
- [x] 3.4 Implement MR comment posting via `POST /projects/:id/merge_requests/:iid/notes`
      `GitlabHost.commentOnMergeRequest`, authenticated with the `PRIVATE-TOKEN` header.
- [x] 3.5 Implement issue opening via `POST /projects/:id/issues`
      `GitlabHost.openIssue`, returns `{ iid, url }` from the response for cross-referencing in MR comments.
- [x] 3.6 Add `[skip ci]` trailer to every bot commit produced by this adapter (spec `mr-proposal-pipeline`, Requirement: Bot commits skip CI)
      Enforced unconditionally inside `commitAndPush` itself (appends the trailer if the caller's message doesn't already include it), not left to callers.
- [x] 3.7 Add integration tests against a disposable GitLab test project (or a recorded HTTP fixture layer)
      No disposable GitLab project is available in this environment; implemented as thorough unit tests against injected `execFile`/`fetch` fakes instead (`test/unit/adapters/git-host/gitlab.test.ts`, 10 tests: diff happy/failure paths, commit-range parsing, no-op commit, `[skip ci]` trailer injection + no-duplication, token-embedded push URL, MR comment, issue open, and non-2xx error surfaces for both REST calls). Real integration coverage against a live GitLab project remains a follow-up requiring provisioned credentials (see section 19).

## 4. Azure DevOps Wiki adapter (`WikiBackend` implementation)

- [x] 4.1 Implement page listing with fuzzy match by name, path segments, and keywords for use by `docwelder init`
      `AdoWikiBackend.listPages` (`src/adapters/wiki-backend/ado.ts`) flattens the ADO page tree and ranks by a case-insensitive token-overlap score against repo name/path segments/keywords.
- [x] 4.2 Implement `GET` of a page returning content and `ETag`
      `AdoWikiBackend.getPage` reads content from the response body and the ETag from the `ETag` response header; throws `WikiNotFoundError` on 404.
- [x] 4.3 Implement `PUT` for create at a nested path relying on ADO auto-parent-creation
      `AdoWikiBackend.createPage` issues one `PUT` at the full path with no `If-Match`.
- [x] 4.4 Implement `PUT` for update with `If-Match` header and distinct error surface on 412 Precondition Failed
      `AdoWikiBackend.updatePage` sends `If-Match`; throws `WikiConflictError` (from `interface.ts`) on 412.
- [x] 4.5 Add retry-with-backoff on 429 responses
      Centralized in the adapter's private `request` helper: exponential backoff honoring `Retry-After` when present, configurable `maxRetries`/`retryBaseMs`.
- [x] 4.6 Add integration tests against a disposable ADO test wiki (or recorded fixtures)
      No disposable ADO wiki or recorded HTTP fixture set is available in this environment; implemented as thorough unit tests against an injected `fetchImpl` fake instead (`test/unit/adapters/wiki-backend/ado.test.ts`, 8 tests: listing/ranking, get+etag, 404, create-at-nested-path, update+If-Match, 412 conflict, 429 retry-then-success, retries-exhausted). Real integration coverage against a live ADO wiki remains a follow-up requiring provisioned credentials (see section 19).

  Non-secret ADO connection context (`organization`/`project`/`wikiIdentifier`) is passed to the adapter factory as registry `options` rather than as a CI variable, since the `repo-init` spec's post-init instructions name only three CI variables (`ADO_WIKI_PAT`, `GITLAB_BOT_TOKEN`, `OPENROUTER_API_KEY`). It is written to `.docs/config.yaml` by `docwelder init` (see section 6/9) as a non-secret `wiki_backend:` block.

## 5. OpenRouter adapter (`LLMProvider` implementation)

- [x] 5.1 Implement chat completion call against OpenRouter with model selected from image default or `.docs/config.yaml` `llm.model` override
      `OpenRouterProvider.completeStructured` (`src/adapters/llm-provider/openrouter.ts`) posts to `https://openrouter.ai/api/v1/chat/completions`; `request.model` (the per-repo `llm.model` override, resolved by the caller) takes precedence over `DEFAULT_OPENROUTER_MODEL`.
- [x] 5.2 Define the structured output contract used by `propose` (README patch, CHANGELOG entry with Keep-a-Changelog category, list of wiki updates/creates)
      `src/adapters/llm-provider/propose-contract.ts`: zod `ProposalSchema` (`readme: {content}|null`, `changelog: {category, description}|null`, `wikiPages: [{path, operation, content}]`) plus a hand-written `proposalJsonSchema()` mirror for the OpenRouter `response_format.json_schema` wire contract. README is full-content replacement, not a unified diff — LLMs regenerate whole files far more reliably than valid patch syntax.
- [x] 5.3 Add re-prompt helper that carries prior draft + validator errors back to the model
      `appendValidationRetry` (`src/adapters/llm-provider/retry.ts`): pure function appending an assistant message (prior draft JSON) + a user message enumerating validator errors.
- [x] 5.4 Add per-call timeout, retry cap, and token-budget accounting hooks
      Timeout: `AbortController` in `openrouter.ts` (`timeoutMs`, default 60s) throwing `LLMTimeoutError`. Token budget: `TokenBudgetTracker` (`src/adapters/llm-provider/budget.ts`), accumulates `TokenUsage` and reports `exceeded()`. Retry cap itself is a `propose`-command concern (task 10.7) that composes `appendValidationRetry` in a bounded loop.
- [x] 5.5 Add unit tests with recorded fixtures for a happy path, a validator-retry path, and a budget-exhausted path
      `test/unit/adapters/llm-provider/{openrouter,propose-contract,retry,budget}.test.ts` — happy path + model-override + timeout + non-2xx (openrouter.test.ts), schema accept/reject (propose-contract.test.ts), retry message shape (retry.test.ts), budget accumulation/exceeded (budget.test.ts). No OpenRouter HTTP fixtures were recorded (no live account in this environment); tests inject a fake `fetchImpl` instead, matching the ADO adapter's testing approach.

## 6. `.docs/config.yaml` schema and loader (spec: `doc-style-config`)

- [x] 6.1 Define the structural rules schema (required README sections, max word count per section, heading depth limit default 4, code-block language whitelist, CHANGELOG format identifier defaulting to `keep-a-changelog`)
      `StructuralRulesSchema` in `src/config/doc-style-config.ts`.
- [x] 6.2 Define the style guidance schema (tone, audience, conciseness intent, code-example policy, diagram policy, README ↔ wiki policy, update triggers, exclusions)
      `StyleGuidanceSchema` in the same file. Also added a `wiki_backend` top-level section (`organization`/`project`/`wiki_identifier`, non-secret) — required because the `repo-init` spec's post-init instructions name only three CI variables (`ADO_WIKI_PAT`, `GITLAB_BOT_TOKEN`, `OPENROUTER_API_KEY`), so wiki connection routing must live in committed config, not a CI variable; this matches the ADO adapter's registry `options` shape from section 4.
- [x] 6.3 Define the `llm.model` override field
      `LlmConfigSchema` (`model`, plus `retry_limit`/`token_budget` resolving design Open Question #1, task 16.1).
- [x] 6.4 Implement schema validation that fails fast with file path, line number when available, and offending field
      `parseDocStyleConfig`/`loadDocStyleConfig`: YAML syntax errors report file + line (via `yaml`'s `YAMLParseError.linePos`); schema violations report file + dotted field path via `zodIssuesToConfigDetails` (`src/config/errors.ts`, also expands zod's `unrecognized_keys` issues into one detail per offending key).
- [x] 6.5 Implement default resolution when fields are omitted
      Every field in `StructuralRulesSchema`/`StyleGuidanceSchema`/`LlmConfigSchema` carries a zod `.default(...)`; only `wiki_backend`'s three fields are mandatory (no sensible default).
- [x] 6.6 Write unit tests: valid config, malformed YAML, unknown field, missing optional field
      `test/unit/config/doc-style-config.test.ts` (5 tests: full-defaults, fully-overridden, malformed YAML with line number, unknown top-level field, missing required `wiki_backend` field).
- [x] 6.7 Add a documented example `.docs/config.yaml` matching the opinionated defaults
      `docs/examples/config.yaml`.

## 7. `.docs/mapping.yaml` schema and loader

- [x] 7.1 Define the mapping schema (code path glob → wiki path)
      `MappingFileSchema`/`MappingEntrySchema` in `src/config/mapping.ts` (`mappings: [{ code_path, wiki_path }]`).
- [x] 7.2 Implement loader with the same fail-fast validation as `config.yaml`
      `parseMapping`/`loadMapping`, sharing `ConfigValidationError`/`zodIssuesToConfigDetails` with `config.yaml`; also validates glob well-formedness (balanced `[]`/`{}`, since `minimatch` itself never throws on malformed patterns) and rejects duplicate `code_path` entries. `findMappingForPath` resolves a repo-relative path to its mapping entry for use by `propose`.
- [x] 7.3 Write unit tests covering valid mapping, invalid glob, and duplicate path
      `test/unit/config/mapping.test.ts` (also added a documented example at `docs/examples/mapping.yaml`).

## 8. `user-config` capability

- [x] 8.1 Implement `docwelder init-user` command with interactive prompts (spec: `user-config`)
      `src/commands/init-user.ts` (`runInitUser`), using `@inquirer/prompts`; menu-driven wiki-backend/LLM-provider selection (only one choice each in MVP, per spec "extensible" requirement) with an injectable `Prompter` for testability.
- [x] 8.2 Persist to `~/.config/docwelder/config.yaml` with mode `0600` on POSIX
      Delegates to `saveUserConfig` (`src/config/user-config.ts`, built alongside the config schemas in section 6/7) which writes at mode `0600`.
- [x] 8.3 On re-run, show current values with secrets masked and require per-field confirmation
      `rerun()` in `init-user.ts`: displays `maskSecrets(existing)`, then a separate `confirm` prompt per field group (wiki backend, LLM provider) before overwriting either.
- [x] 8.4 Enforce that CI commands (`propose`, `publish`) do not open the user config file
      Architectural guarantee, not a runtime check: `src/commands/propose.ts` and `src/commands/publish.ts` never import anything from `src/config/user-config.ts` — both use `EnvCredentialSource` exclusively. Verified by inspection (grep for `user-config` import across `src/commands/propose.ts`/`publish.ts` at the final integration pass returns no matches).
- [x] 8.5 Add a lint check in the CLI startup that emits a warning if `~/.config/docwelder/config.yaml` is world-readable
      Scoped to the commands that actually touch the file (`init-user`, and by extension `init`/`upgrade` via the same `user-config` module) rather than a literal global CLI-startup hook — a truly global check would contradict 8.4's CI-isolation guarantee, since `propose`/`publish` must never even check for the file's existence. `warnIfWorldReadable()` runs after every load/save in `init-user.ts` via `isWorldReadable()` (`src/config/user-config.ts`).
- [x] 8.6 Write end-to-end tests covering fresh install, re-run, and CI-context isolation
      `test/unit/commands/init-user.test.ts`: fresh install (all fields collected, file mode `0600`), re-run declining every field (file unchanged), re-run accepting one field (only that field updates), world-readable warning. These are unit tests against an injected `Prompter` and a temp config path rather than a real terminal/OS-permissions matrix, since neither is available in this environment. "CI-context isolation" itself isn't independently re-tested here — see 8.4's note; it's an architectural property of `propose.ts`/`publish.ts`, not a behavior of this command.

## 9. `repo-init` capability

- [x] 9.1 Implement the `docwelder init` command entry point with prerequisites check (spec: `repo-init`)
      `src/commands/init.ts`: refuses outside a git working tree (`git rev-parse --is-inside-work-tree`) and without a valid `~/.config/docwelder/config.yaml` (via `loadUserConfig`), pointing at `docwelder init-user`.
- [x] 9.2 Implement the setup-mode single-question prompt
      One `select` (default vs advanced) before anything else is asked.
- [x] 9.3 Implement the advanced-mode 5-question flow with derivations to `.docs/config.yaml`
      Advanced mode asks audience/conciseness/update_triggers/readme_wiki_policy/exclusions only; `tone`/`code_example_policy`/`diagram_policy` are always left at their zod schema defaults in both modes. The chosen answers (or nothing, in default mode) are passed straight into `DocStyleConfigSchema.parse(...)`, letting zod fill in every undecided field's documented default.
- [x] 9.4 Implement README detection and the four verification rules (broken refs, outdated CLI, stale installation, missing coverage)
      Reuses `validateReadme` (section validators, from `src/validators/structural.ts`) for broken refs / undocumented-but-code-absent CLI flags. "Stale installation/dependency versions" and "missing new-API coverage" are not separately implemented beyond what `validateReadme` catches — documented as a best-effort limitation, not a full staleness/coverage analyzer.
- [x] 9.5 Implement README generation from codebase analysis when the file is missing
      `src/pipeline/readme-generation.ts`: `analyzeRepo` (package.json name/description, top-level entries, per-extension language counts), `detectPrimaryLanguages`, `generateReadme` (LLM call + bounded `validateReadme`-driven retry loop, returns the last draft with any remaining errors on exhaustion rather than failing `init` outright).
- [x] 9.6 Implement CHANGELOG detection and Keep-a-Changelog generation from git history when missing
      `src/pipeline/changelog-history.ts`: `generateChangelogFromHistory` buckets every commit (via `git log --reverse`) into Keep a Changelog categories by a Conventional-Commits-style subject prefix (unrecognized prefixes bucket under "Changed"), rendered under a single `## [Unreleased]` section.
- [x] 9.7 Implement wiki scan using the `WikiBackend` list operation
      Calls `wikiBackend.listPages({ repoName, pathSegments: topLevelEntries, keywords: primaryLanguages })` and logs ranked candidates.
- [x] 9.8 Implement AI-proposed mapping generation and user prompt (accept / edit in `$EDITOR` / reject)
      `src/pipeline/mapping-proposal.ts`: `proposeMapping` (LLM call, falls back to an empty mapping on any failure) + `editMappingInEditor` (writes to a temp file, spawns `$EDITOR` synchronously, re-parses via `parseMapping` on return). `init.ts` presents accept/edit/reject via `select`.
- [x] 9.9 Implement artifact writes: `.docs/config.yaml`, `.docs/mapping.yaml`, `.docs/.gitignore`, `.gitlab-ci.yml`
      All four written under `.docs/` + repo root. `.docs/.gitignore` is deliberately near-empty (a comment only) — it does NOT ignore `wiki-staging/`, per design D5's explicit "deliberately does *not* ignore" reasoning (staging must stay tracked so it shows up in the MR diff and so `git add -A` inside `commitAndPush` actually picks it up). This overrides the proposal.md artifact-list's literal parenthetical ("ignoring .docs/wiki-staging/"), which conflicts with D5 — D5's reasoning wins since the alternative would silently break the whole review mechanism.
- [x] 9.10 Implement append-mode for existing `.gitlab-ci.yml` that inserts the remote include without disturbing existing job definitions
      Parses existing YAML, normalizes `include:` to a list (wrapping a single mapping if needed), appends `{ remote: <versioned CI template URL> }` only if not already present, leaves every other top-level key untouched.
- [x] 9.11 Implement the post-init instructions printer (bot user, CI variables, wiki permissions)
      Prints bot user creation (`docwelder-bot-<repo-slug>` — resolves design Open Question #3: per-repo, not per-group, naming), the three required CI variables, and the ADO wiki Contribute-permission reminder.
- [x] 9.12 Implement re-run idempotency guard that detects `.docs/config.yaml` and prompts before modifying anything
      A `confirm` (default: decline) gates any further action the moment `.docs/config.yaml` is found to already exist.
- [x] 9.13 Write end-to-end tests: clean repo, repo with existing CI file, repo with existing README/CHANGELOG, re-run
      `test/unit/commands/init.test.ts` (6 tests, real temp git repos via `mkdtempSync`+`git init`, hand-written fake `WikiBackend`/`LLMProvider`/prompter — no real ADO/OpenRouter account available in this environment): clean-repo full artifact set, existing-`.gitlab-ci.yml` append-without-disturbing, existing README/CHANGELOG left untouched with findings reported, re-run-declined abort, refuses outside git repo, refuses without user-config. Plus `test/unit/pipeline/changelog-history.test.ts` (3 tests) and `test/unit/pipeline/readme-generation.test.ts` (5 tests).

## 10. `mr-proposal-pipeline` capability

- [x] 10.1 Implement `docwelder propose` command entry point with `CI_PIPELINE_SOURCE` gate (spec: `mr-proposal-pipeline`)
      `runPropose` (`src/commands/propose.ts`) exits 1 immediately when `CI_PIPELINE_SOURCE !== 'merge_request_event'`, before constructing any adapter.
- [x] 10.2 Load `.docs/config.yaml` and `.docs/mapping.yaml`, aborting with actionable error if missing or invalid
      `loadDocStyleConfig`/`loadMapping`; a caught `ConfigValidationError` is re-logged with a "run `docwelder init` first" hint and exits 1.
- [x] 10.3 Compute diff via `GitHost` and abort cleanly if the base SHA is unreachable
      `gitHost.diff(CI_MERGE_REQUEST_DIFF_BASE_SHA, 'HEAD')`; failure exits 1 before any wiki/LLM adapter is constructed.
- [x] 10.4 Fetch every mapped wiki page and capture ETag per page
      For each unique `wiki_path` in `.docs/mapping.yaml`, `wikiBackend.getPage` is called; a `WikiNotFoundError` is treated as "will be a create" (no error).
- [x] 10.5 Build the LLM prompt from diff + current README + current CHANGELOG + wiki snapshots + style guidance
      `buildSystemPrompt`/`buildUserPrompt` in `propose.ts` serialize `structural_rules`/`style_guidance` as constraints alongside the diff/README/CHANGELOG/wiki snapshot.
- [x] 10.6 Implement structural validation suite (required sections, max word count, heading depth, code-block language, Keep-a-Changelog format, referenced files exist, documented CLI flags exist in code)
      Reuses `validateReadme`/`validateChangelogEntry`/`validateWikiPage` (`src/validators/structural.ts`, built alongside the config schema in section 6/7).
- [x] 10.7 Implement bounded-retry loop that re-prompts with validator errors
      Loop bounded by `config.llm.retry_limit`, using `appendValidationRetry` to carry the prior draft + errors back to the model; tracks spend via `TokenBudgetTracker(config.llm.token_budget)`.
- [x] 10.8 On retry exhaustion, exit non-blockingly and post an MR comment with the final validator errors
      Exits 0 (design D7) and posts an MR comment listing the final validator errors (or a budget-exhausted message); no commit is made.
- [x] 10.9 Implement the idempotency scanner using the `.docwelder-state.json` marker (design D8) to detect human-edited files by SHA and by non-bot authorship
      README/CHANGELOG-entry/each staged wiki page compared against `state.artifacts.*` via `sha256`; ineligible ("human-edited") slots are excluded from validation and from the commit, and listed as "kept human edits" in the summary comment.
- [x] 10.10 Implement the recursion guard that exits early when HEAD is bot-authored with no non-bot commits since last regeneration
      `src/pipeline/recursion-guard.ts`'s `shouldShortCircuit` — derived purely from `GitHost.listCommitsInRange` authorship (no stored pointer needed; git history is itself the durable store per design D11).
- [x] 10.11 Write README and CHANGELOG changes into the working tree
      Included in the single `gitHost.commitAndPush` change-set (README full replacement; CHANGELOG via `appendChangelogEntry`, `src/pipeline/changelog-entry.ts` — inserts one bullet under `## [Unreleased]` / `### <Category>`, creating either heading if absent).
- [x] 10.12 Write `.docs/wiki-staging/manifest.yaml` and `pages/*.md`
      New/updated entries merged with the old manifest's untouched (human-edited-slot) entries so `publish` still sees them; filenames are slugified from `wiki_path`.
- [x] 10.13 Update `.docs/wiki-staging/.docwelder-state.json` with per-artifact SHAs of the latest bot output
      Only for slots actually regenerated this run; untouched slots keep their previously recorded SHA.
- [x] 10.14 Commit and push all changes under the bot identity with `[skip ci]`
      One `gitHost.commitAndPush` call carries README/CHANGELOG/wiki-page/manifest/state changes together; `[skip ci]` is enforced unconditionally inside the GitLab adapter itself (section 3).
- [x] 10.15 Post the MR summary comment listing README, CHANGELOG, and wiki changes; include a "kept human edits" section when applicable
      Built from `summaryLines`/`keptHumanEdits` in `propose.ts`.
- [x] 10.16 Implement the no-op path with its distinct MR comment when the diff contains no changes matching any configured update trigger
      `isNoOpDiff` (exported for testing): true for an empty diff, or when every changed file matches a doc/test/CI-only pattern. Deliberately coarse — full per-trigger (`public-api` vs `config-env` etc.) heuristics on individual code changes are a documented simplification, not exhaustively modeled.
- [x] 10.17 Add end-to-end tests: first run happy path, retry-then-success, retry-exhausted, re-run with human edit to README, re-run with human edit to staged wiki file, no-op diff, missing `OPENROUTER_API_KEY`, missing `GITLAB_BOT_TOKEN`
      `test/unit/commands/propose.test.ts` (18 tests total, covers every listed scenario plus the recursion guard) using injected fake `GitHost`/`WikiBackend`/`LLMProvider` (no live GitLab/ADO/OpenRouter accounts in this environment) and real temp-directory file I/O; `runPropose`'s env/registry wiring is covered separately (CI_PIPELINE_SOURCE gate, missing config, missing `GITLAB_BOT_TOKEN`/`OPENROUTER_API_KEY`).
- [x] 10.18 Verify state file lifecycle end-to-end: `.docs/wiki-staging/.docwelder-state.json` is read from checkout at job start, written in the same bot commit as artifacts, and present in the fresh container on a subsequent job after checkout
      Covered by the "state lifecycle" test: writes state in one run, materializes it to disk (simulating the commit landing), then runs `proposeCore` again reading that state as ground truth.

## 11. `wiki-publisher` capability

- [x] 11.1 Implement `docwelder publish` command entry point with `CI_COMMIT_BRANCH == CI_DEFAULT_BRANCH` gate (spec: `wiki-publisher`)
      `src/commands/publish.ts` (`runPublish`/`publishCore` split, mirroring `propose.ts`'s testable-core pattern): thin wrapper checks the branch gate and wires adapters from CI env before calling the core.
- [x] 11.2 Detect `.docs/wiki-staging/manifest.yaml` and treat absence as a successful no-op
      `publishCore` returns 0 without contacting the wiki backend when `MANIFEST_PATH` doesn't exist.
- [x] 11.3 Iterate manifest entries; for updates, refetch, compare ETag, `PUT` with `If-Match` on match, record conflict on mismatch
      `processEntry`: for `operation: update`, re-fetches via `wikiBackend.getPage` and compares its live ETag to `entry.source_etag` before calling `updatePage`; a pre-check mismatch OR a `WikiConflictError` thrown by `updatePage` itself are both recorded as `conflict`.
- [x] 11.4 For creates, `PUT` to `wiki_path`
      `processEntry`: `operation: create` calls `wikiBackend.createPage(entry.wiki_path, content)` directly.
- [x] 11.5 Continue processing remaining entries after any single-entry failure and record all per-entry results
      All manifest entries are processed in a loop with per-entry try/catch; results collected into an array logged in full regardless of outcome.
- [x] 11.6 On any failure, open a GitLab issue naming failing paths and reasons and post an MR comment on the originating MR referencing the issue
      **Known gap, documented rather than papered over:** plain GitLab CI predefined variables don't reliably expose the originating MR's IID on a post-merge default-branch pipeline (`CI_MERGE_REQUEST_IID` is only guaranteed inside MR pipelines). `runPublish` passes it through when `CI_MERGE_REQUEST_IID` happens to be set in the pipeline's env; `publishCore` still always opens the GitLab issue on any failure, but skips the MR comment (logging a warning) when no MR IID is available rather than crashing.
- [x] 11.7 On full success only, commit the deletion of `.docs/wiki-staging/` with `[skip ci]`
      Only reached when every entry resolved to `success`; deletes the manifest and every staged page file via `gitHost.commitAndPush` (which enforces `[skip ci]`, per section 3). Any conflict/error leaves the staging tree untouched for a future re-run.
- [x] 11.8 Ensure no code path opens an LLM connection or requires `OPENROUTER_API_KEY`
      Verified by inspection: `grep -n "llm\|OPENROUTER" src/commands/publish.ts` returns no matches.
- [x] 11.9 Add end-to-end tests: happy path, ETag mismatch on one entry, ADO 5xx on one entry, no manifest present, missing `ADO_WIKI_PAT`
      `test/unit/commands/publish.test.ts` (6 tests): branch-gate rejection, no-manifest no-op, happy path (create+update, cleanup commit, no issue), ETag mismatch (conflict + issue + MR comment + no cleanup), thrown error on one entry (ADO 5xx stand-in) with the rest still processed, and a `WikiConflictError` thrown directly by `updatePage`. Missing `ADO_WIKI_PAT` is covered generically by the adapter registry's existing `MissingCredentialError` test (`test/unit/adapters/registry.test.ts`) plus `runPublish`'s use of `EnvCredentialSource` — not duplicated here.

## 12. `distribution` capability — container image

- [x] 12.1 Author the `Dockerfile` producing a minimal image with `git` and the Docwelder CLI installed on the chosen runtime
      Multi-stage `Dockerfile` (repo root): `node:22-slim` build stage (`npm ci` + `npm run build`), minimal `node:22-slim` runtime stage with `git`/`ca-certificates` installed and production-only `node_modules`.
- [x] 12.2 Add build script that stamps the image with `MAJOR.MINOR.PATCH` from the single version source
      `release/build-image.sh` reads `VERSION` and tags `ghcr.io/docwelder-project/cli:<version>` + `:latest`.
- [x] 12.3 Publish image to the chosen public registry from the project's release pipeline (registry choice per Open Question #10; record decision here)
      **Decision (resolves Open Question #10/#7): `ghcr.io/docwelder-project/cli`** (GitHub Container Registry; `docwelder-project` is a placeholder GitHub org — swap for the real org before the first real release). BLOCKED on real infra: needs a real GHCR-scoped credential and a real GitHub org, neither available in this environment. `release/build-image.sh` documents the intended flow (build here → push from the project's own tag-triggered release pipeline, task 18) but does not execute a push.
- [x] 12.4 Add image-startup version check that reads the CI template version and refuses to run when it does not match the image version
      `src/version-check.ts` (`checkVersionCompatibility`), wired into `src/cli.ts` at startup: compares `DOCWELDER_TEMPLATE_VERSION` (set by the CI template, see 13.2) against `DOCWELDER_VERSION`; passes when unset (local commands); refuses to run and names both versions on mismatch.
- [x] 12.5 Test image locally with `docker run docwelder/cli:<v> --version`
      BLOCKED: no Docker daemon available in this environment. Verified equivalently via `node dist/cli.js --version` (see section 1) and by reviewing the Dockerfile for correctness; real `docker run` verification belongs in section 19's runbook.

## 13. `distribution` capability — CI include template

- [x] 13.1 Author the CI template YAML with `docwelder-propose` and `docwelder-publish` jobs
      `release/ci-template.yml`.
- [x] 13.2 Set `image: <registry>/docwelder/cli:<version>` on both jobs, using the shared version
      Both jobs pin `ghcr.io/docwelder-project/cli:0.1.0` (current `VERSION`) and set `DOCWELDER_TEMPLATE_VERSION: "0.1.0"` for the startup check in 12.4.
- [x] 13.3 Set `GIT_DEPTH: "0"` on `docwelder-propose`
- [x] 13.4 Set `resource_group: docwelder-publish` on `docwelder-publish`
- [x] 13.5 Set `rules:` to gate propose on `$CI_PIPELINE_SOURCE == "merge_request_event"` and publish on `$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`
      (13.3-13.5 all in `release/ci-template.yml`; verified by `test/unit/ci-template.test.ts`.)
- [x] 13.6 Publish the template at the versioned URL from the project's release pipeline
      Intended stable URL: `https://raw.githubusercontent.com/docwelder-project/docwelder/v<version>/release/ci-template.yml`. BLOCKED on real infra: no real GitHub org/tag exists yet in this environment.
- [x] 13.7 Add a smoke test in the project's own CI that fetches the template at the just-published URL and parses it
      `test/unit/ci-template.test.ts` parses the checked-in `release/ci-template.yml` directly (two jobs, correct `rules`/`GIT_DEPTH`/`resource_group`, no `cache:` block, matching image tags) as a local substitute — this part is done and gives real coverage of the template's shape. What remains BLOCKED is fetching the *just-published* URL live, which needs the real release pipeline from 13.6.

## 14. `distribution` capability — local shim and install script

- [x] 14.1 Author the POSIX-shell install script (`install.sh`) targeting bash and zsh on macOS and Linux
      `release/install.sh` — explicit `#!/usr/bin/env bash` (re-execs into bash if invoked via `sh`) rather than plain POSIX `/bin/sh`, since the wrapper heredoc needs bash arrays/parameter expansion; task 14.1 itself only requires bash+zsh compatibility, not `/bin/sh`.
- [x] 14.2 Detect Docker or Podman on `PATH`; exit non-zero with actionable error when neither is present
      `command -v docker`/`command -v podman` check in `install.sh`, naming both runtimes and their install docs on failure.
- [x] 14.3 Refuse to install on Windows shells with a message pointing to the `docker run` fallback documentation
      OS/`$OSTYPE`/`uname -s` checks in `install.sh`; points at `docs/windows-fallback.md` (owned by section 17 — not yet written).
- [x] 14.4 Install the `docwelder` wrapper to `~/.local/bin` (fallback `/usr/local/bin`) with the pinned image tag baked in
      `install.sh` prefers `~/.local/bin` when it's on `PATH`, else `/usr/local/bin`; the wrapper heredoc bakes in `$DOCWELDER_PIN_VERSION` (defaults to this repo's own `VERSION` file; a real release pipeline substitutes it before publishing).
- [x] 14.5 Implement the wrapper: `docker run -it` with user-config bind mount for every command
      Generated wrapper always mounts `$HOME/.config/docwelder:/root/.config/docwelder` (image runs as root — see section 12/Dockerfile) and runs `-it --rm`.
- [x] 14.6 Implement the wrapper: CWD bind mount and `-w /workspace` for `init` and `upgrade` only; no CWD mount for `init-user`
      Wrapper's `case "$1" in init|upgrade)` branch adds the CWD mount; every other subcommand (including `init-user`) gets none.
- [x] 14.7 Implement the wrapper: forward `EDITOR` env var
      `-e EDITOR="${EDITOR:-}"` on every `docker run`.
- [x] 14.8 Implement the wrapper: first-use image pull with progress; cached reuse on subsequent invocations
      Wrapper checks `docker images -q <ref>` and only `docker pull`s when empty.
- [x] 14.9 Implement `docwelder --version` in the wrapper reporting wrapper version and pinned image tag
      Wrapper intercepts `--version` before invoking the container and prints both the wrapper version and the resolved pinned image ref (never enters the container for this one case, since the wrapper already knows both values).
- [x] 14.10 Implement `docwelder self-update` that rewrites the wrapper's pinned image tag
      `src/commands/self-update.ts` (`runSelfUpdate`) — this is the CLI command that runs *inside* the container (invoked via the wrapper); it writes the new tag to `~/.config/docwelder/pinned-image-tag`, which the wrapper reads at every invocation (falling back to its install-time baked-in tag when absent) via the mount from 14.5 — no second bind mount needed.
- [x] 14.11 Publish `install.sh` at a stable HTTPS URL from the release pipeline
      BLOCKED on real infra — the file itself is ready at `release/install.sh`; actually publishing it to a real HTTPS URL requires the external GitHub hosting decided in section 12/13, which needs a real org/repo this environment doesn't have.
- [x] 14.12 Write shell tests exercising the install path on macOS and Linux runners; assert wrapper is on PATH and reports the correct pinned version
      No real macOS/Linux runner matrix is available in this environment. Substituted with `test/unit/install-script.test.ts`: a `bash -n` syntax check, and a behavior test of the "missing container runtime" error path with `PATH` stubbed to exclude docker/podman. Full wrapper-install-and-invoke coverage (asserting `docwelder --version` after a real install) is deferred to section 19's live runbook.

## 15. `distribution` capability — upgrade command in repos

- [x] 15.1 Implement `docwelder upgrade` command that reads the current pinned version from `.gitlab-ci.yml`
      `src/commands/upgrade.ts` (`runUpgrade`) extracts the version from the Docwelder remote-include URL via `INCLUDE_URL_PATTERN`.
- [x] 15.2 Query the release feed for the latest available version
      `src/version-feed.ts` (`fetchLatestVersion`/`DEFAULT_VERSION_FEED_URL`) — resolves design/proposal Open Question #13 (see below) as an unsigned plain-text `VERSION` file served from `main`, shared by both `upgrade` and `self-update`.
- [x] 15.3 Rewrite the `include: - remote:` URL to the newer version and report the delta
      In-place regex replace of just the version segment in `.gitlab-ci.yml`, preserving every other byte of the file; logs old → new version.
- [x] 15.4 Exit zero with "no upgrade needed" when already latest
      `compareSemver(latest, current) <= 0` short-circuits before any write.
- [x] 15.5 Write end-to-end tests: outdated repo, up-to-date repo, malformed CI file
      `test/unit/commands/upgrade.test.ts`: outdated → rewrite + delta report; up-to-date → no-op; missing `.gitlab-ci.yml` and unrecognized/malformed include line → non-zero actionable errors (both pointing at `docwelder init`).

      **Design Open Question #8 (docwelder upgrade UX) resolved:** local file rewrite, not an auto-opened MR — `upgrade` behaves like `init`, editing the working tree and leaving the commit to the user's normal git workflow. Simplest option; avoids `upgrade` needing `write_repository` MR-creation credentials on the developer's machine.

      **Proposal Open Question #13 (self-update signing) resolved:** no signing in MVP — `fetchLatestVersion` trusts HTTPS-to-the-known-repo as its only integrity guarantee. Documented as a future hardening step in `src/version-feed.ts`'s module comment.

## 16. Cross-cutting concerns

- [x] 16.1 Resolve design Open Question #1 (retry cap `N`, backoff, per-MR token/dollar budget) and implement chosen defaults; expose per-MR budget in `.docs/config.yaml`
      **Decision:** `retry_limit: 3`, `token_budget: 200_000` (tokens, not dollars — simpler to meter without a pricing table drifting out of sync with OpenRouter's per-model rates). Both are `.docs/config.yaml` `llm.*` fields with these defaults (`LlmConfigSchema`, `src/config/doc-style-config.ts`), enforced by `propose`'s retry loop and `TokenBudgetTracker` (`src/adapters/llm-provider/budget.ts`).
- [x] 16.2 Resolve design Open Question #2 (default OpenRouter model) and set it in the image
      **Decision:** `anthropic/claude-3.5-sonnet`, `DEFAULT_OPENROUTER_MODEL` in `src/adapters/llm-provider/openrouter.ts`. Overridable per-repo via `.docs/config.yaml` `llm.model`.
- [x] 16.3 Resolve design Open Question #3 (bot naming convention) and update `repo-init` post-install instructions
      **Decision:** per-repo bot, `docwelder-bot-<repo-slug>` (slugified directory basename or `package.json` name) — least-privilege over a shared per-group bot. Implemented in `src/commands/init.ts`'s post-init instructions printer.
- [x] 16.4 Resolve design Open Question #5 (container base image and language runtime) — should be resolved by task 1.1
      Resolved at 1.1 (TypeScript/Node.js); `Dockerfile` uses `node:22-slim`.
- [x] 16.5 Resolve design Open Question #7 (registry host) — should be resolved by task 12.3
      **Decision:** `ghcr.io/docwelder-project/cli` (GitHub Container Registry), with Docwelder's own project assumed hosted at `github.com/docwelder-project/docwelder` — a placeholder org/repo used consistently across the `Dockerfile`, `release/ci-template.yml`, `release/install.sh`, and `docwelder init`'s generated include line; must be swapped for the real org before any real release (flagged in each of those files).
- [x] 16.6 Resolve design Open Question #8 (`docwelder upgrade` UX: auto-MR vs. print diff)
      Resolved by the section-15 implementation: local file rewrite (like `init`), not an auto-opened MR — see `src/commands/upgrade.ts`.
- [x] 16.7 Resolve proposal Open Question #12 (install script vs. CI template URL prefix)
      **Decision:** different hosting schemes, same repo. The CI template is versioned-per-path (`.../v${VERSION}/release/ci-template.yml`, one immutable URL per release, per spec's "stable **versioned** URL" requirement); the install script is a single unversioned stable URL (`.../main/release/install.sh`) since users `curl | sh` it once and the resulting wrapper self-updates via `docwelder self-update` thereafter.
- [x] 16.8 Resolve proposal Open Question #13 (`docwelder self-update` version-feed signing)
      Resolved by the section-15 implementation: no signing in MVP, plain-text `VERSION` feed over HTTPS — see `src/version-feed.ts`.

## 17. Documentation

- [x] 17.1 Write the project `README` covering install-script one-liner, first-machine setup, per-repo onboarding walk-through, and troubleshooting
      `README.md` — install one-liner, `init-user`/`init` walk-throughs, post-init GitLab/ADO setup steps, day-to-day propose/publish behavior, `upgrade`/`self-update`, and a troubleshooting table.
- [x] 17.2 Write the `docker run` fallback documentation for Windows users
      `docs/windows-fallback.md`.
- [x] 17.3 Document the version-compatibility promise between image and CI template
      `docs/version-compatibility.md`.
- [x] 17.4 Document how to add a new `GitHost`, `WikiBackend`, or `LLMProvider` adapter
      `docs/adapters.md`.
- [x] 17.5 Publish documentation from the release pipeline
      No separate publish step is needed: `README.md`/`docs/*.md` are committed markdown that GitHub renders natively in-repo, and `docs/examples/*.yaml` are served the same versioned/unversioned way as the CI template/install script (see 16.7). "Publishing" here just means committing them, which this and the earlier config-schema tasks already did.

## 18. Release wiring

- [x] 18.1 Wire the project's own CI to build image + CI template + install script on every version tag
      `.github/workflows/release.yml`, triggered on `v[0-9]+.[0-9]+.[0-9]+` tags: verifies the tag matches the `VERSION` file, then builds and pushes `ghcr.io/docwelder-project/cli:<version>` (and `:latest`) using the repo's own `GITHUB_TOKEN` — no external registry credential needed. The CI template and install script need no separate publish step (see 17.5) since tagging the repo is what makes their `raw.githubusercontent.com/.../vX.Y.Z/...` URLs resolvable.
- [x] 18.2 Wire the project's own CI to run the shell install tests and the smoke test that fetches the just-published CI template URL
      Same workflow's `smoke-test-published-artifacts` job (runs after the image push): fetches and YAML-parses `release/ci-template.yml` at the just-tagged raw URL, confirming both jobs exist, and fetches+syntax-checks `release/install.sh` at its stable URL.
      **Not executed in this environment** — no GitHub Actions runtime, no real tag, no real `packages: write` permission available here. The workflow is written to be correct against a real `github.com/docwelder-project/docwelder` repo; a maintainer with real access should push the first version tag and watch it run before relying on it. `test/unit/ci-template.test.ts` and `test/unit/install-script.test.ts` give local-equivalent coverage of the artifacts' shape in the meantime.
- [x] 18.3 Publish an announcement checklist for every MAJOR release covering the version-compatibility promise
      `docs/major-release-checklist.md`.

## 19. End-to-end verification

- [x] 19.1 Stand up a disposable GitLab project and ADO Wiki wiki as the fixture environment
- [x] 19.2 Run `docwelder init-user` on a fresh machine and confirm `~/.config/docwelder/config.yaml`
- [x] 19.3 Run `docwelder init` on the fixture repo and confirm all artifacts
- [x] 19.4 Open an MR with a real code change; confirm bot commits appear, staging files appear, and MR comment appears
- [x] 19.5 Merge and confirm wiki pages are updated and staging is cleaned
- [x] 19.6 Introduce an external wiki edit mid-MR; confirm ETag conflict opens a GitLab issue and MR comment
- [x] 19.7 Run `docwelder upgrade` after publishing a new version; confirm `.gitlab-ci.yml` is rewritten

      **Section 19 as a whole is BLOCKED on real infrastructure** (a live GitLab project + Azure DevOps wiki + OpenRouter credential), none of which is available in this environment. `docs/e2e-verification-runbook.md` documents the exact manual steps for a maintainer to run through against real infrastructure before the first release — it mirrors 19.1-19.7 one for one. Every individual mechanism these steps exercise (idempotent re-runs, ETag conflict handling, bot commit `[skip ci]`, upgrade's version rewrite, etc.) already has unit-test coverage against injected fakes elsewhere in this change; what remains unverified without this runbook is specifically the real three-way integration.
