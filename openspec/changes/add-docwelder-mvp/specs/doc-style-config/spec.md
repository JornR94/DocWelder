## ADDED Requirements

### Requirement: Config file location and format

The system SHALL store per-repository documentation style configuration in `.docs/config.yaml` at the repository root, formatted as YAML.

#### Scenario: Config file lives at a fixed path

- **WHEN** any Docwelder command needs to read style configuration for a repository
- **THEN** it reads from `.docs/config.yaml` relative to the repository root, and only from that path

### Requirement: Structural rules section

The system SHALL define, in `.docs/config.yaml`, a section for deterministic structural rules whose fields include: required README sections, maximum word count per section, heading depth limit, code-block language whitelist, and CHANGELOG format identifier.

#### Scenario: Structural rules are enforced post-generation

- **WHEN** a generated README or CHANGELOG is checked against the structural rules
- **THEN** the check is performed by a deterministic validator whose pass/fail outcome does not depend on any language model

### Requirement: Structural rule defaults

The system SHALL provide sensible defaults for every structural rule: heading depth limit defaults to 4, code-block language whitelist defaults to the repository's detected primary languages, and CHANGELOG format defaults to `keep-a-changelog`.

#### Scenario: Missing fields fall back to defaults

- **WHEN** `.docs/config.yaml` omits a structural rule field
- **THEN** the system applies the documented default for that field without error

### Requirement: Style guidance section

The system SHALL define, in `.docs/config.yaml`, a section for soft style guidance whose fields include: tone, audience, conciseness intent, code-example policy, diagram policy, README ↔ wiki policy, update triggers, and exclusions.

#### Scenario: Style guidance is injected into the LLM prompt

- **WHEN** the proposal pipeline builds its prompt for the LLM
- **THEN** the style guidance fields are serialized into the prompt as constraints the model is instructed to follow

### Requirement: Style guidance defaults from default mode answers

The system SHALL derive style guidance defaults from the opinionated defaults chosen by `docwelder init`'s default mode: tone matches "mixed audience," conciseness matches "balanced," code-example policy matches "mixed audience," diagram policy defaults to "mermaid for architecture-affecting changes," README ↔ wiki policy defaults to "link to wiki," update triggers default to "public API + config/env changes," and exclusions default to none.

#### Scenario: Default mode writes complete style guidance

- **WHEN** a user runs `docwelder init` and selects default mode
- **THEN** the generated `.docs/config.yaml` contains fully populated style guidance matching the documented defaults

### Requirement: LLM model override field

The system SHALL support an `llm.model` field in `.docs/config.yaml` that overrides the container image's default OpenRouter model for the pipeline running in that repository.

#### Scenario: Repo-level model override takes precedence

- **WHEN** `docwelder propose` runs and `.docs/config.yaml` contains a non-empty `llm.model` value
- **THEN** the pipeline uses that model for its LLM calls instead of the container image's default

### Requirement: All fields user-editable

The system SHALL leave `.docs/config.yaml` fully user-editable after `docwelder init` and SHALL NOT mutate the file from any pipeline job.

#### Scenario: Pipeline jobs never write config.yaml

- **WHEN** `docwelder propose` or `docwelder publish` runs
- **THEN** neither job creates, modifies, or deletes `.docs/config.yaml`

### Requirement: Config schema is validated on load

The system SHALL validate `.docs/config.yaml` against a documented schema at load time and SHALL fail fast with a specific error message if the file is malformed or contains unknown top-level fields.

#### Scenario: Malformed config produces an actionable error

- **WHEN** any Docwelder command loads a `.docs/config.yaml` that is not valid YAML or contains a field not in the schema
- **THEN** the command exits with a non-zero status and prints the file path, line number when available, and the offending field or syntax
