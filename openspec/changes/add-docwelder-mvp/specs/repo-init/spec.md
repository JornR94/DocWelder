## ADDED Requirements

### Requirement: Init command entry point

The system SHALL provide a `docwelder init` command that, when run in the root of a git repository, performs one-time onboarding of that repository to Docwelder.

#### Scenario: Init refuses to run outside a git repository

- **WHEN** a user runs `docwelder init` in a directory that is not inside a git working tree
- **THEN** the command exits with a non-zero status and an error explaining that a git repository is required

#### Scenario: Init requires prior user-level setup

- **WHEN** a user runs `docwelder init` on a machine without a valid `~/.config/docwelder/config.yaml`
- **THEN** the command exits with a non-zero status and instructs the user to run `docwelder init-user` first

### Requirement: Setup mode prompt

The system SHALL ask the user exactly one question at the start of `docwelder init` offering a choice between a default opinionated setup and an advanced 5-question setup.

#### Scenario: Default mode applies opinionated defaults

- **WHEN** the user selects the default mode
- **THEN** the system applies the opinionated default profile (audience: mixed; depth: balanced; update triggers: public API + config/env changes; README ↔ wiki: link to wiki; exclusions: none) without asking further configuration questions

#### Scenario: Advanced mode asks at most five questions

- **WHEN** the user selects the advanced mode
- **THEN** the system asks at most five questions covering audience, depth, update triggers, README ↔ wiki overlap policy, and exclusions, and no additional configuration questions

### Requirement: README detection and verification

The system SHALL detect whether a `README.md` exists at the repository root and, when present, verify it against the codebase using four rules: broken references to files or directories, outdated CLI commands or flags, stale installation or dependency versions, and missing coverage of new public APIs.

#### Scenario: Missing README triggers generation

- **WHEN** `docwelder init` runs in a repo with no `README.md`
- **THEN** the system generates a README from codebase analysis and writes it to `README.md`

#### Scenario: Existing README is verified but not overwritten

- **WHEN** `docwelder init` runs in a repo with an existing `README.md`
- **THEN** the system reports any of the four verification issues it finds and leaves the file unchanged, deferring corrections to the first MR run

### Requirement: CHANGELOG detection and generation

The system SHALL detect whether a `CHANGELOG.md` exists at the repository root and, when missing, generate an initial one from git history using the Keep a Changelog format.

#### Scenario: Missing CHANGELOG is generated from git history

- **WHEN** `docwelder init` runs in a repo with no `CHANGELOG.md`
- **THEN** the system generates `CHANGELOG.md` populated from git history and formatted per Keep a Changelog

#### Scenario: Existing CHANGELOG is left as-is

- **WHEN** `docwelder init` runs in a repo with an existing `CHANGELOG.md`
- **THEN** the system does not modify the file

### Requirement: Wiki scanning for related pages

The system SHALL scan the configured wiki backend for pages potentially related to the current repository, matching by repository name, path segments, and detected keywords.

#### Scenario: Wiki scan surfaces candidate pages

- **WHEN** `docwelder init` performs wiki scanning
- **THEN** the system lists candidate wiki pages with a match strength indicator for each

### Requirement: AI-proposed explicit mapping

The system SHALL present the user with an AI-proposed mapping of code paths to wiki pages for approval, edit, or rejection before writing any mapping to disk.

#### Scenario: User accepts the proposed mapping

- **WHEN** the user accepts the AI-proposed mapping unchanged
- **THEN** the system writes the mapping to `.docs/mapping.yaml`

#### Scenario: User edits the proposed mapping before accepting

- **WHEN** the user opts to edit the mapping
- **THEN** the system opens the mapping in the user's editor and writes the edited version to `.docs/mapping.yaml` on save

### Requirement: Repository artifact writes

The system SHALL write the following artifacts to the repository at the conclusion of a successful `docwelder init`: `.docs/config.yaml`, `.docs/mapping.yaml`, `.docs/.gitignore` (ignoring `.docs/wiki-staging/`), and `.gitlab-ci.yml` (or a CI include line appended to an existing `.gitlab-ci.yml`).

#### Scenario: Clean repo receives full artifact set

- **WHEN** `docwelder init` completes on a repo with no existing `.docs/` directory and no existing `.gitlab-ci.yml`
- **THEN** the four artifacts above are created

#### Scenario: Existing .gitlab-ci.yml is preserved

- **WHEN** `docwelder init` completes on a repo that already has a `.gitlab-ci.yml`
- **THEN** the system appends the Docwelder remote `include:` line without altering existing job definitions

### Requirement: Post-init setup instructions

The system SHALL print, to standard output at the end of `docwelder init`, the setup steps the user must perform outside of Docwelder before the pipeline can run: creating a GitLab bot user with project access token, adding CI variables `ADO_WIKI_PAT`, `GITLAB_BOT_TOKEN`, and `OPENROUTER_API_KEY`, and confirming the bot has Contribute permission on the target wiki.

#### Scenario: Instructions are printed to the terminal, not written to a file

- **WHEN** `docwelder init` completes successfully
- **THEN** the setup instructions appear in the terminal output and no additional file is written to the repository to hold them

### Requirement: Init is idempotent

The system SHALL support re-running `docwelder init` on an already-onboarded repository without duplicating or corrupting artifacts.

#### Scenario: Re-run detects existing artifacts

- **WHEN** `docwelder init` runs in a repo where `.docs/config.yaml` already exists
- **THEN** the command reports that the repo is already onboarded and prompts the user before modifying any existing artifact
