# Docwelder

Semi-automated, user-confirmed documentation sync between your codebase, README, CHANGELOG, and wiki. The codebase is the source of truth: on every merge request, Docwelder proposes README, CHANGELOG, and wiki updates derived from the diff, a human reviews them alongside the code, and approved changes ship on merge.

Docwelder ships as a versioned container image plus a two-job GitLab CI pipeline. There is no server to operate and no persistent state outside your repository and your wiki.

> **MVP scope:** GitLab (self-hosted or gitlab.com) as the git host, Azure DevOps Wiki as the wiki backend, OpenRouter as the LLM provider. See [Extending Docwelder](docs/adapters.md) for adding others.

## Install

Requires [Docker](https://docs.docker.com/get-docker/) or [Podman](https://podman.io/getting-started/installation) on macOS or Linux. Windows is not supported by the local install script in MVP — see the [`docker run` fallback](docs/windows-fallback.md).

```sh
curl -fsSL https://raw.githubusercontent.com/JornR94/DocWelder/main/release/install.sh | sh
```

This installs a `docwelder` wrapper to `~/.local/bin` (falling back to `/usr/local/bin`) that transparently runs the pinned Docwelder image via Docker/Podman — you never type `docker run` yourself. Verify with:

```sh
docwelder --version
```

## First-machine setup

Once, per machine, before your first `docwelder init`:

```sh
docwelder init-user
```

This interactively collects your wiki backend selection (Azure DevOps Wiki in MVP) and credentials, and your LLM provider (OpenRouter) API key, and persists them to `~/.config/docwelder/config.yaml` (mode `0600`, never committed, never read by CI). Re-running `init-user` shows current values with secrets masked and asks per-field before overwriting anything.

## Onboarding a repository

Inside a git repository:

```sh
docwelder init
```

`init` will:

1. Ask a single question — default (opinionated) setup, or advanced (up to five questions covering audience, depth, update triggers, README↔wiki policy, and exclusions).
2. Detect or generate `README.md` (verified against the codebase if it already exists; generated from codebase analysis if missing).
3. Detect or generate `CHANGELOG.md` (generated from git history in Keep a Changelog format if missing).
4. Scan your configured wiki for pages that look related to this repository.
5. Propose an explicit code-path → wiki-page mapping for you to accept, edit in `$EDITOR`, or reject.
6. Write `.docs/config.yaml`, `.docs/mapping.yaml`, `.docs/.gitignore`, and a `.gitlab-ci.yml` (or append to an existing one) that includes Docwelder's CI template.
7. Print the setup steps you still need to do outside Docwelder (below).

Re-running `init` on an already-onboarded repo asks for confirmation before touching anything.

### After `init`: required GitLab/ADO setup

`docwelder init` prints these instructions at the end of a successful run — do them before merging your first MR:

1. Create a GitLab bot user named `docwelder-bot-<repo-slug>` with Developer/Maintainer role and a project access token scoped to `api` + `write_repository`.
2. Add CI/CD variables (masked, protected): `ADO_WIKI_PAT`, `GITLAB_BOT_TOKEN`, `OPENROUTER_API_KEY`.
3. Confirm the bot user has **Contribute** permission on the target Azure DevOps wiki.

The CI template requires `GIT_DEPTH: "0"` on the propose job (already set for you) — orgs that mandate shallow clones cannot run Docwelder in MVP.

## Day to day

- **On every merge request**, the `docwelder-propose` CI job runs automatically, computes the diff, and — if anything doc-relevant changed — commits README/CHANGELOG updates to your MR branch and stages wiki page proposals under `.docs/wiki-staging/`, then posts a summary comment on the MR. Pushing new commits re-runs it without clobbering your manual edits to the generated files.
- **On merge to the default branch**, the `docwelder-publish` CI job publishes the staged wiki pages (ETag-guarded against concurrent external edits) and cleans up the staging directory. If anything conflicts or fails, it opens a GitLab issue and comments on the originating MR instead of silently dropping the change.

## Keeping Docwelder up to date

```sh
docwelder upgrade     # bumps this repo's pinned CI template version in .gitlab-ci.yml
docwelder self-update # bumps your local wrapper's pinned image tag
```

Both edit the relevant file/pin locally and report the version delta; neither auto-commits or opens a merge request — review and commit as part of your normal workflow. Both exit cleanly with "no update needed" when you're already current.

## Troubleshooting

| Symptom                                                                       | Likely cause                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docwelder init` refuses to run                                               | Not inside a git repository, or `docwelder init-user` hasn't been run yet on this machine.                                                                                                                                                                       |
| `docwelder propose` exits immediately with a `CI_PIPELINE_SOURCE` error       | The job isn't running in a merge-request pipeline — this is expected on other pipeline sources.                                                                                                                                                                  |
| `docwelder propose` fails citing a missing variable                           | One of `OPENROUTER_API_KEY` / `GITLAB_BOT_TOKEN` isn't set as a CI/CD variable on the project.                                                                                                                                                                   |
| `docwelder publish` opens a GitLab issue about an ETag mismatch               | Someone edited the wiki page outside Docwelder between MR open and merge. Re-run `docwelder propose` on a new commit to pick up the current content — this is by design (see [design.md](openspec/changes/add-docwelder-mvp/design.md), decision D4), not a bug. |
| The propose job fails "non-blockingly" with validator errors in an MR comment | The LLM's output didn't satisfy `.docs/config.yaml`'s structural rules after the retry cap. The MR is not blocked from merging; adjust `.docs/config.yaml` or retry by pushing a new commit.                                                                     |
| Image refuses to start, citing a version mismatch                             | The pinned container image tag and the CI template version have drifted apart. Run `docwelder upgrade` to realign them.                                                                                                                                          |

## More documentation

- [Version compatibility between the image and the CI template](docs/version-compatibility.md)
- [Windows: the `docker run` fallback](docs/windows-fallback.md)
- [Extending Docwelder with a new `GitHost`, `WikiBackend`, or `LLMProvider`](docs/adapters.md)
- [Example `.docs/config.yaml`](docs/examples/config.yaml) and [`.docs/mapping.yaml`](docs/examples/mapping.yaml)
- [Proposal](openspec/changes/add-docwelder-mvp/proposal.md) and [design](openspec/changes/add-docwelder-mvp/design.md) for the full rationale behind these choices

## Contributing / running from source

```sh
npm ci
npm run build
npm test
```

See `package.json` for the full script list (`lint`, `format`, `typecheck`, `test:unit`, `test:e2e`).
