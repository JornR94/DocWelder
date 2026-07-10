## ADDED Requirements

### Requirement: Propose command entry point

The system SHALL provide a `docwelder propose` command intended to run inside a GitLab CI job triggered on `merge_request_event`.

#### Scenario: Command runs only in a merge_request pipeline

- **WHEN** `docwelder propose` runs in a CI environment where `CI_PIPELINE_SOURCE` is not `merge_request_event`
- **THEN** the command exits with a non-zero status and prints an error explaining that it is designed for MR pipelines

### Requirement: Diff acquisition via local git

The system SHALL compute the changeset under review as `git diff $CI_MERGE_REQUEST_DIFF_BASE_SHA...HEAD` using the local git checkout, and the published CI template SHALL set `GIT_DEPTH: "0"` on the propose job to ensure the merge base is reachable.

#### Scenario: Full history is available when the job starts

- **WHEN** `docwelder propose` starts inside the CI container
- **THEN** the value of `CI_MERGE_REQUEST_DIFF_BASE_SHA` resolves to a commit that exists in the local git history

#### Scenario: Diff acquisition failure aborts the job

- **WHEN** `git diff` cannot resolve the base SHA for any reason
- **THEN** the command exits with a non-zero status and reports the failure without contacting the LLM or the wiki

### Requirement: Wiki page snapshot with ETag capture

The system SHALL, for each wiki page referenced by `.docs/mapping.yaml`, fetch the current page content and its `ETag` header from the wiki backend and retain both values for the remainder of the propose run.

#### Scenario: ETag is captured per page

- **WHEN** the pipeline fetches a mapped wiki page during propose
- **THEN** the response's `ETag` value is retained and later written to `.docs/wiki-staging/manifest.yaml` as `source_etag` for that page

### Requirement: LLM-driven proposal generation

The system SHALL generate the following outputs via the configured LLM provider using inputs consisting of the diff, the current README, the current CHANGELOG, the wiki page snapshot, and the fields from `.docs/config.yaml`: a README patch, a CHANGELOG entry classified per Keep a Changelog categories, and per-mapped-page wiki updates or creates.

#### Scenario: All three output types are produced in one pass

- **WHEN** the LLM call completes successfully
- **THEN** the model output is parsed into a README patch, a CHANGELOG entry, and a set of wiki page updates/creates, each of which may be empty

### Requirement: Deterministic structural validation with bounded retries

The system SHALL validate every generated artifact against the structural rules from `.docs/config.yaml` and, on any validation failure, SHALL re-prompt the LLM with the validator errors and the current draft, up to a bounded retry limit N.

#### Scenario: First pass succeeds

- **WHEN** the initial LLM output passes all structural validators
- **THEN** the pipeline proceeds to write artifacts without further LLM calls

#### Scenario: Retry succeeds within the cap

- **WHEN** structural validation fails and the retry count is below N
- **THEN** the system issues a re-prompt including the validator errors and re-runs validation on the new output

#### Scenario: Retries exhausted

- **WHEN** structural validation fails on the Nth retry
- **THEN** the job exits non-blockingly (the MR is not blocked from merging) and the bot posts a comment listing the final set of validator errors

### Requirement: Bot-authored commit of README and CHANGELOG changes

The system SHALL commit README and CHANGELOG changes to the merge request's source branch using a bot identity authenticated via `GITLAB_BOT_TOKEN`.

#### Scenario: Bot commit is pushed to the MR source branch

- **WHEN** the pipeline has generated valid README or CHANGELOG changes
- **THEN** the changes are committed under the bot identity and pushed to `$CI_MERGE_REQUEST_SOURCE_BRANCH` of the source project

### Requirement: Bot commits skip CI

The system SHALL include `[skip ci]` in the commit message of every bot-authored commit.

#### Scenario: Skip-ci trailer is present on bot commits

- **WHEN** the bot creates any commit during propose (README/CHANGELOG or staging)
- **THEN** the commit message contains `[skip ci]`

### Requirement: Wiki proposals written to staging

The system SHALL write wiki proposals to the MR branch under `.docs/wiki-staging/`, consisting of a `manifest.yaml` and one file per proposed page under `pages/`.

#### Scenario: Update entry in manifest

- **WHEN** a proposal updates an existing wiki page
- **THEN** the manifest entry for that page has `operation: update`, the target `wiki_path`, the captured `source_etag`, and a `local_file` path pointing at the corresponding file under `pages/`

#### Scenario: Create entry in manifest

- **WHEN** a proposal creates a new wiki page
- **THEN** the manifest entry for that page has `operation: create`, the target `wiki_path`, and a `local_file` path, with no `source_etag`

### Requirement: MR summary comment

The system SHALL post one comment per propose run to the merge request via the GitLab API, summarizing the README changes, CHANGELOG entry, and wiki updates or creates being proposed.

#### Scenario: Successful run posts a summary comment

- **WHEN** propose completes successfully with at least one proposed change
- **THEN** a single MR comment is posted summarizing README, CHANGELOG, and wiki changes with links to the affected files or paths

### Requirement: No-op outcome is a supported result

The system SHALL treat "no doc changes required" as a valid successful outcome that emits a distinct MR comment and exits zero.

#### Scenario: No doc-affecting diff

- **WHEN** the diff contains no changes matching any configured update trigger
- **THEN** the bot posts an MR comment stating that no documentation changes are required, does not write any artifacts, and exits with a zero status

### Requirement: Idempotent re-runs preserve human edits

The system SHALL, on any propose run after the first on the same MR, detect files that have been modified by non-bot authors since the last bot commit and SHALL NOT overwrite those files. The state marker file `.docs/wiki-staging/.docwelder-state.json` SHALL be read from the repository checkout at job start and updated in the same bot commit that writes README, CHANGELOG, and staging artifacts, ensuring that a fresh container on the next run has ground truth immediately after checkout.

#### Scenario: Human edit to a staged wiki page is preserved

- **WHEN** a developer edits `.docs/wiki-staging/pages/*.md` and pushes a new commit
- **THEN** the next propose run leaves that file unchanged and notes it in the MR summary comment as "kept human edits"

#### Scenario: Human edit to README is preserved

- **WHEN** a developer edits `README.md` on the MR branch after a bot commit
- **THEN** the next propose run does not overwrite the human-authored changes and reports the file as kept

### Requirement: Bot commits do not trigger propose recursively

The system SHALL detect and short-circuit propose runs that would only regenerate content already up to date, in addition to the `[skip ci]` guard on bot commits.

#### Scenario: HEAD is a bot commit with no non-bot commits since last run

- **WHEN** a propose run starts and the branch's most recent non-bot commit predates the last recorded bot regeneration
- **THEN** the run exits early with a zero status and a no-op comment

### Requirement: LLM provider identified by config, credential by CI variable

The system SHALL determine the LLM provider from configuration (image default, overridable by `.docs/config.yaml` `llm.model`) and SHALL obtain the provider credential from the CI variable `OPENROUTER_API_KEY`.

#### Scenario: Missing OpenRouter credential aborts the job

- **WHEN** `docwelder propose` starts and `OPENROUTER_API_KEY` is unset or empty
- **THEN** the command exits with a non-zero status and prints an error naming the missing variable

### Requirement: GitLab bot token authenticates the commit push and comment

The system SHALL authenticate the git push of bot commits and the posting of the MR comment using the CI variable `GITLAB_BOT_TOKEN`.

#### Scenario: Missing GitLab bot token aborts the job

- **WHEN** `docwelder propose` needs to push a commit or post a comment and `GITLAB_BOT_TOKEN` is unset or empty
- **THEN** the command exits with a non-zero status and prints an error naming the missing variable
