## ADDED Requirements

### Requirement: Container image is the sole runtime distribution

The system SHALL be distributed as a versioned container image published to a public container registry, and this image SHALL be the only runtime artifact required to execute any `docwelder` command inside CI or locally.

#### Scenario: A single image tag suffices for CI execution

- **WHEN** a CI job pulls the Docwelder image at a specific version tag and runs `docwelder propose` or `docwelder publish`
- **THEN** no additional plugin, package, or module needs to be installed for the command to execute

### Requirement: Image tag is a semantic version

The system SHALL tag every published container image with a semantic version of the form `MAJOR.MINOR.PATCH`.

#### Scenario: Image tag matches template version

- **WHEN** a user inspects the Docwelder image tag referenced from a given CI template version
- **THEN** the image tag equals the template version, matching one-to-one

### Requirement: CI include template is published at a stable versioned URL

The system SHALL publish a GitLab CI include template YAML at a stable URL that embeds the version, so that `docwelder init` can write an `include: - remote: <url>` line pinned to a specific version.

#### Scenario: Versioned URL is reachable

- **WHEN** the Docwelder project publishes version `X.Y.Z`
- **THEN** the CI template for that version is retrievable via HTTPS at a URL whose path includes `X.Y.Z`

### Requirement: CI include template defines the two pipeline jobs

The CI template SHALL define exactly two jobs: `docwelder-propose` and `docwelder-publish`, referencing the pinned container image and applying the pipeline-specific rules.

#### Scenario: Propose job runs only on MR events

- **WHEN** the CI template is evaluated by GitLab
- **THEN** the `docwelder-propose` job's rules include `$CI_PIPELINE_SOURCE == "merge_request_event"` and no other trigger

#### Scenario: Publish job runs only on default-branch pushes

- **WHEN** the CI template is evaluated by GitLab
- **THEN** the `docwelder-publish` job's rules include `$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH` and no other trigger

### Requirement: Propose job runs with full git history

The CI template SHALL set `GIT_DEPTH: "0"` on the `docwelder-propose` job so that the merge base referenced by `CI_MERGE_REQUEST_DIFF_BASE_SHA` is reachable in the local clone.

#### Scenario: Depth 0 is set on propose

- **WHEN** the CI template is applied to a repository
- **THEN** the `docwelder-propose` job variables include `GIT_DEPTH: "0"`

### Requirement: Publish job is serialized

The CI template SHALL set `resource_group: docwelder-publish` on the `docwelder-publish` job.

#### Scenario: Resource group is declared

- **WHEN** the CI template is applied to a repository
- **THEN** the `docwelder-publish` job declares `resource_group: docwelder-publish`

### Requirement: Image and template versions are compatible one-to-one

The system SHALL guarantee that a CI template at version `X.Y.Z` is compatible only with the container image at the same version `X.Y.Z`.

#### Scenario: Mismatched versions do not silently succeed

- **WHEN** the container image inspects the CI template version at startup and finds a mismatch
- **THEN** the container refuses to run any pipeline command and prints an error naming both versions

### Requirement: docwelder init writes a remote include line

The `docwelder init` command SHALL write a `.gitlab-ci.yml` (or append to an existing one) whose relevant content is a single `include: - remote: <pinned-versioned-url>` referencing the CI template at the version of Docwelder that ran `init`.

#### Scenario: Fresh init pins the current version

- **WHEN** a user runs `docwelder init` using Docwelder version `X.Y.Z`
- **THEN** the generated `.gitlab-ci.yml` contains a remote include whose URL embeds `X.Y.Z`

### Requirement: Upgrade command bumps the pinned version

The system SHALL provide a `docwelder upgrade` command that, when run in a Docwelder-onboarded repository, updates the pinned version in the repo's `.gitlab-ci.yml` remote include to a newer available version.

#### Scenario: Upgrade to the latest version

- **WHEN** a user runs `docwelder upgrade` in a repository whose `.gitlab-ci.yml` pins Docwelder version `X.Y.Z` and a newer version is available
- **THEN** the command updates the pinned version in the include URL to the newer version and reports the version delta to the user

#### Scenario: No upgrade available

- **WHEN** a user runs `docwelder upgrade` in a repository whose pinned version is already the latest
- **THEN** the command exits with a zero status and reports that no upgrade is needed

### Requirement: Local install script published at a stable HTTPS URL

The system SHALL publish a POSIX-shell install script at a stable HTTPS URL that installs the local `docwelder` wrapper on a user's machine.

#### Scenario: Curl-pipe install works on macOS with bash or zsh

- **WHEN** a user on macOS runs `curl -fsSL <install-url> | sh` in a bash or zsh shell
- **THEN** the install script completes with a zero exit status and reports the installed wrapper path

#### Scenario: Curl-pipe install works on Linux with bash or zsh

- **WHEN** a user on Linux runs `curl -fsSL <install-url> | sh` in a bash or zsh shell
- **THEN** the install script completes with a zero exit status and reports the installed wrapper path

### Requirement: Install script places the wrapper on the user's PATH

The install script SHALL place an executable `docwelder` wrapper into a directory on the user's `PATH` (defaulting to `~/.local/bin` or `/usr/local/bin` as appropriate).

#### Scenario: Wrapper is invocable after install

- **WHEN** a user opens a new shell after a successful install
- **THEN** running `docwelder --version` succeeds and prints both the wrapper version and the pinned image tag

### Requirement: Wrapper transparently pulls the pinned image

The wrapper SHALL invoke the local container runtime to pull the pinned Docwelder image on first use of any command and SHALL reuse the cached image on subsequent invocations.

#### Scenario: First invocation pulls the image

- **WHEN** a user runs `docwelder init-user` on a machine where the pinned image is not present in the local runtime cache
- **THEN** the wrapper pulls the image before executing the command

#### Scenario: Subsequent invocations reuse the cached image

- **WHEN** a user runs any `docwelder` command after the pinned image has already been pulled
- **THEN** the wrapper does not re-pull the image and executes the command against the cached copy

### Requirement: Wrapper mounts the user config directory for every invocation

The wrapper SHALL bind-mount the host directory containing `~/.config/docwelder/` into the container for every command it runs, so that reads and writes to `~/.config/docwelder/config.yaml` from inside the container land on the host filesystem.

#### Scenario: init-user persists to the host

- **WHEN** a user runs `docwelder init-user` via the wrapper and completes the prompts
- **THEN** `~/.config/docwelder/config.yaml` exists on the host after the container exits, owned by the invoking user

### Requirement: Wrapper mounts the current working directory for repo-scoped commands only

The wrapper SHALL bind-mount the host's current working directory into the container and set the container's working directory to that mount for commands that operate on a repository (`init`, `upgrade`), and SHALL NOT mount the current working directory for commands that do not (`init-user`).

#### Scenario: init mounts the repo working directory

- **WHEN** a user runs `docwelder init` inside a git repository via the wrapper
- **THEN** the container sees the repository files at its working directory and any files the command writes appear in the host repository

#### Scenario: init-user does not mount the repo working directory

- **WHEN** a user runs `docwelder init-user` via the wrapper from within a git repository
- **THEN** the container has no bind mount of the current working directory and cannot read or write files in the host repository

### Requirement: Wrapper forwards TTY and preserves the EDITOR environment variable

The wrapper SHALL allocate a TTY for interactive commands and SHALL forward the host's `EDITOR` environment variable into the container so that prompts and editor launches behave as they would in a native install.

#### Scenario: Mapping editor prompt opens the user's editor

- **WHEN** during `docwelder init` the user chooses to edit the proposed mapping
- **THEN** the editor specified by the host's `EDITOR` variable opens on the mapping file, and saving that editor returns control to the interactive prompt

### Requirement: Wrapper pins the image tag at install time

The wrapper SHALL be installed with a specific pinned Docwelder image tag and SHALL use exactly that tag for every command until the pin is changed.

#### Scenario: Version output reports the pinned tag

- **WHEN** a user runs `docwelder --version`
- **THEN** the output includes the wrapper's own version and the pinned container image tag, and both correspond to the version delivered by the install script that produced the wrapper

### Requirement: Self-update command bumps the wrapper's pinned image tag

The system SHALL provide a `docwelder self-update` command that updates the local wrapper's pinned image tag to a newer available version.

#### Scenario: Self-update to the latest version

- **WHEN** a user runs `docwelder self-update` on a machine whose wrapper pins version `X.Y.Z` and a newer version is available
- **THEN** the wrapper's pinned image tag is updated to the newer version and the command reports the version delta to the user

#### Scenario: No self-update available

- **WHEN** a user runs `docwelder self-update` on a machine whose wrapper is already pinned to the latest version
- **THEN** the command exits with a zero status and reports that no update is needed

### Requirement: Docker or Podman is a documented prerequisite

The install script SHALL detect the presence of a supported container runtime (Docker or Podman) before installing the wrapper and SHALL refuse to install with an actionable error when none is present.

#### Scenario: Missing container runtime aborts install

- **WHEN** the install script runs on a machine where neither `docker` nor `podman` is on `PATH`
- **THEN** the script exits with a non-zero status and prints an error naming the two supported runtimes and where to install them

### Requirement: MVP local shim platform scope

The install script SHALL support macOS and Linux with bash or zsh for MVP and SHALL refuse to install on other platforms with a clear message.

#### Scenario: Windows install is refused

- **WHEN** the install script is invoked on a Windows shell environment
- **THEN** the script exits with a non-zero status and prints a message stating that Windows is not supported in MVP and pointing to the `docker run` fallback documentation

### Requirement: CI template does not use runner-side caching

The CI template SHALL NOT declare a `cache:` block on either the `docwelder-propose` or `docwelder-publish` job, so that Docwelder never depends on GitLab runner-side persistence between jobs.

#### Scenario: No cache blocks in the published template

- **WHEN** the published CI template is parsed
- **THEN** neither the `docwelder-propose` job nor the `docwelder-publish` job contains a `cache:` key at any nesting level
