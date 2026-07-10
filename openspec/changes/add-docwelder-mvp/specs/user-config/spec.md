## ADDED Requirements

### Requirement: First-install command

The system SHALL provide a `docwelder init-user` command that runs interactively on a user's machine and captures the information required to make subsequent local `docwelder init` invocations self-sufficient.

#### Scenario: Fresh install with no prior config

- **WHEN** a user runs `docwelder init-user` on a machine with no existing `~/.config/docwelder/config.yaml`
- **THEN** the command prompts for wiki backend selection, wiki backend credentials, LLM provider selection, and LLM provider credentials, and persists all answers to `~/.config/docwelder/config.yaml`

#### Scenario: Re-run overwrites prior values only when confirmed

- **WHEN** a user runs `docwelder init-user` and a config file already exists
- **THEN** the command shows the current values (with secrets masked) and requires explicit confirmation before overwriting each field

### Requirement: Wiki backend selection is extensible

The system SHALL present wiki backend selection as a menu whose implementation supports adding new backends without modifying the command's user-facing prompt structure.

#### Scenario: MVP presents only Azure DevOps Wiki

- **WHEN** the user is prompted for wiki backend during `docwelder init-user`
- **THEN** the menu lists "Azure DevOps Wiki" as the only selectable option, with a note that additional backends are planned

### Requirement: Azure DevOps Wiki credentials capture

The system SHALL collect the four values required to authenticate against an Azure DevOps Wiki when that backend is selected: organization, project, wikiIdentifier, and a Personal Access Token.

#### Scenario: All four ADO values are required

- **WHEN** the user selects Azure DevOps Wiki as their backend
- **THEN** the command refuses to proceed until organization, project, wikiIdentifier, and PAT are all provided

### Requirement: OpenRouter credential capture

The system SHALL collect an OpenRouter API key when OpenRouter is selected as the LLM provider.

#### Scenario: OpenRouter key is required

- **WHEN** the user selects OpenRouter as their LLM provider
- **THEN** the command refuses to proceed until an API key is provided

### Requirement: User config is stored under the user's home directory only

The system SHALL persist user-scoped configuration exclusively at `~/.config/docwelder/config.yaml` (or the platform-appropriate XDG-compliant location) and SHALL NOT write user-scoped credentials into any repository, CI variable, or shared filesystem.

#### Scenario: Config path is user-scoped

- **WHEN** `docwelder init-user` completes successfully
- **THEN** the only new file on disk is `~/.config/docwelder/config.yaml` with permissions restricted to the current user (mode 0600 or platform equivalent)

### Requirement: User config is consumed only by local commands

The system SHALL read `~/.config/docwelder/config.yaml` only from commands that run on the user's machine (`docwelder init-user`, `docwelder init`, `docwelder upgrade`) and SHALL NOT read it from commands that run inside CI (`docwelder propose`, `docwelder publish`).

#### Scenario: CI commands ignore user config

- **WHEN** `docwelder propose` or `docwelder publish` runs inside a CI container
- **THEN** the command reads credentials solely from environment variables and never opens `~/.config/docwelder/config.yaml`, even if such a file exists in the container filesystem

### Requirement: CI commands are stateless between runs

The system SHALL treat every invocation of `docwelder propose` and `docwelder publish` as executing in a fresh container with no persisted state from any prior invocation. All inputs SHALL come from the repository checkout, CI environment variables, or the wiki backend.

#### Scenario: Fresh container on every job

- **WHEN** `docwelder propose` or `docwelder publish` runs in a container whose filesystem contains only the standard image layers, the checked-out repository, and the CI environment
- **THEN** the command completes correctly without any file, cache, or state carried over from a previous CI job
