## ADDED Requirements

### Requirement: Publish command entry point

The system SHALL provide a `docwelder publish` command intended to run inside a GitLab CI job triggered on push to the repository's default branch.

#### Scenario: Command runs only on the default branch

- **WHEN** `docwelder publish` runs in a CI environment where `CI_COMMIT_BRANCH` does not equal `CI_DEFAULT_BRANCH`
- **THEN** the command exits with a non-zero status and prints an error explaining that it is designed for default-branch pushes

### Requirement: Serialized execution via resource_group

The published CI template SHALL declare `resource_group: docwelder-publish` on the publish job so that concurrent pushes to the default branch produce serialized publish runs.

#### Scenario: Concurrent merges do not run publish in parallel

- **WHEN** two merges to the default branch produce two publish pipelines within a short window
- **THEN** GitLab serializes the two publish jobs so that at most one is executing at any time

### Requirement: Manifest detection

The system SHALL detect the presence of `.docs/wiki-staging/manifest.yaml` at the start of every publish run and SHALL treat its absence as a successful no-op.

#### Scenario: No manifest present

- **WHEN** `docwelder publish` runs and no `.docs/wiki-staging/manifest.yaml` exists in the checked-out tree
- **THEN** the command exits with a zero status and does not contact the wiki backend

### Requirement: Update operations use If-Match ETag guard

The system SHALL, for every manifest entry with `operation: update`, first fetch the current state of the target wiki page, compare its `ETag` to the entry's `source_etag`, and only proceed with the update when they match.

#### Scenario: ETag matches

- **WHEN** the live ETag equals the entry's `source_etag`
- **THEN** the system issues a `PUT` to the wiki page with `If-Match: <source_etag>` and the local file's content

#### Scenario: ETag does not match

- **WHEN** the live ETag differs from the entry's `source_etag`
- **THEN** the system aborts that entry, records a conflict for it, and continues processing the remaining entries

### Requirement: Create operations use PUT to target path

The system SHALL, for every manifest entry with `operation: create`, issue a `PUT` to the target `wiki_path` and rely on the wiki backend to auto-create any intermediate path segments.

#### Scenario: Create at a nested path

- **WHEN** an entry has `operation: create` and `wiki_path: /A/B/C`
- **THEN** the system issues a `PUT` at `/A/B/C` and does not attempt to pre-create `/A` or `/A/B`

### Requirement: Per-entry result recording

The system SHALL record a per-entry result (success, conflict, or error) for every manifest entry processed during a publish run.

#### Scenario: Mixed outcomes are all recorded

- **WHEN** a publish run processes multiple entries and produces a mix of success, conflict, and error outcomes
- **THEN** the run's summary logs each entry with its target path and outcome, without stopping at the first failure

### Requirement: Failure surfaces via GitLab issue and MR comment

The system SHALL, on any per-entry conflict or error, open a GitLab issue describing the failure and post a comment on the originating merge request identifying the affected entries.

#### Scenario: Conflict opens an issue

- **WHEN** any entry in a publish run ends in conflict or error
- **THEN** the system opens a GitLab issue with the failing wiki paths, the failure reason for each, and a link to the originating MR

#### Scenario: Comment on the originating MR

- **WHEN** any entry in a publish run ends in conflict or error
- **THEN** the system posts a comment on the merge request whose merge produced the run, referencing the newly opened GitLab issue

### Requirement: Successful cleanup commit

The system SHALL, only when every entry in the manifest resolved to success, commit the removal of the entire `.docs/wiki-staging/` tree under the bot identity with `[skip ci]` in the commit message.

#### Scenario: All entries succeed

- **WHEN** every entry in a publish run succeeds
- **THEN** the system commits the deletion of `.docs/wiki-staging/manifest.yaml` and everything under `.docs/wiki-staging/pages/` in one commit with `[skip ci]` in its message

#### Scenario: Any entry fails

- **WHEN** at least one entry in a publish run ends in conflict or error
- **THEN** the system does not remove any staging files and leaves the tree intact for a subsequent re-run to reconcile

### Requirement: No LLM dependency

The system SHALL NOT contact the LLM provider or require an LLM credential for any code path of `docwelder publish`.

#### Scenario: Publish succeeds without OPENROUTER_API_KEY

- **WHEN** `docwelder publish` runs in a CI environment where `OPENROUTER_API_KEY` is unset
- **THEN** the command completes normally provided the wiki-related credentials are present

### Requirement: Wiki backend credentials from CI variable

The system SHALL obtain wiki backend credentials for publish from the CI variable `ADO_WIKI_PAT` (and equivalent variables for future backends).

#### Scenario: Missing ADO PAT aborts the job

- **WHEN** `docwelder publish` starts and `ADO_WIKI_PAT` is unset or empty and the repository's wiki backend is Azure DevOps Wiki
- **THEN** the command exits with a non-zero status and prints an error naming the missing variable
