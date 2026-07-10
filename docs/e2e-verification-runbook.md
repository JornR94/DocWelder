# End-to-end verification runbook

Section 19 of `tasks.md` calls for live verification against a real GitLab project and a real Azure DevOps wiki. Neither is available in the environment this MVP was implemented in (no credentials, no disposable GitLab/ADO instance), so this document is the manual runbook a maintainer with access to both should run through before the first real release. Every step below is covered in isolation by the unit test suite (`npm test` — 142 tests across adapters, config, pipeline, and commands as of this writing); what's _not_ covered without this runbook is the real integration between GitLab, Azure DevOps Wiki, and OpenRouter all at once.

## Prerequisites (19.1)

- [ ] A disposable/test GitLab project (self-hosted or gitlab.com) you can freely commit to, open MRs against, and grant a bot user access to.
- [ ] A disposable/test Azure DevOps project with a wiki, and a PAT with Contribute permission on it.
- [ ] An OpenRouter API key with a small budget (propose calls the configured model — `anthropic/claude-3.5-sonnet` by default).
- [ ] Docker or Podman installed locally, and either a real `ghcr.io/jornr94/docwelder` image published (see `.github/workflows/release.yml`) or a locally-built one substituted via the wrapper/CI template's image reference for this test.

## Fresh machine setup (19.2)

```sh
docwelder init-user
```

- [ ] Select Azure DevOps Wiki, enter organization/project/wiki identifier/PAT.
- [ ] Select OpenRouter, enter the API key.
- [ ] Confirm `~/.config/docwelder/config.yaml` exists, mode `0600`, and contains what you entered.
- [ ] Re-run `docwelder init-user`; confirm secrets are shown masked and nothing is overwritten unless you explicitly confirm each field.

## Onboard the fixture repo (19.3)

```sh
cd <fixture-repo>
docwelder init
```

- [ ] Confirm `.docs/config.yaml`, `.docs/mapping.yaml`, `.docs/.gitignore`, and `.gitlab-ci.yml` are all created.
- [ ] Confirm `.docs/.gitignore` does **not** ignore `wiki-staging/` (design D5 — this must stay tracked).
- [ ] Confirm the post-init instructions correctly name a bot user as `docwelder-bot-<repo-slug>`.
- [ ] Follow the printed instructions: create that GitLab bot user with a project access token (`api` + `write_repository`), add `ADO_WIKI_PAT`/`GITLAB_BOT_TOKEN`/`OPENROUTER_API_KEY` as masked+protected CI/CD variables, confirm the bot has Contribute permission on the ADO wiki.

## Propose on a real MR (19.4)

- [ ] Push a branch with a real code change (e.g. a new public function/CLI flag) and open an MR.
- [ ] Confirm the `docwelder-propose` job runs (only on `merge_request_event` pipelines) and, if the change is doc-relevant:
  - [ ] A bot commit appears on the MR branch updating README/CHANGELOG, authored by the bot identity, with `[skip ci]` in the message.
  - [ ] `.docs/wiki-staging/manifest.yaml` and `pages/*.md` appear in the same commit and are visible in the MR diff.
  - [ ] A single MR comment summarizes the README/CHANGELOG/wiki changes.
- [ ] Push a small manual edit to the generated README on the same branch, then push another trivial code commit — confirm the next propose run does **not** clobber your edit, and the MR comment notes it as a kept human edit.

## Merge and publish (19.5)

- [ ] Merge the MR.
- [ ] Confirm the `docwelder-publish` job runs (only on default-branch pushes, serialized via `resource_group: docwelder-publish`).
- [ ] Confirm the staged wiki page(s) now exist/are updated in the real ADO wiki with the proposed content.
- [ ] Confirm `.docs/wiki-staging/` is removed from the repo in a `[skip ci]` cleanup commit.

## External wiki edit mid-MR (19.6)

- [ ] Open a new MR with another doc-relevant change (propose stages a wiki update with a captured ETag).
- [ ] Before merging, edit that same wiki page directly in Azure DevOps (outside Docwelder).
- [ ] Merge the MR and confirm `docwelder publish`:
  - [ ] Detects the ETag mismatch for that entry.
  - [ ] Opens a GitLab issue naming the page and the reason.
  - [ ] Comments on the originating MR referencing that issue.
  - [ ] Leaves `.docs/wiki-staging/` in place (no cleanup commit) since not every entry succeeded.

## Upgrade (19.7)

- [ ] Publish a new Docwelder version (bump `VERSION`, tag, let `.github/workflows/release.yml` build+push).
- [ ] In the fixture repo, run `docwelder upgrade`; confirm it rewrites only the version segment of the `include:` URL in `.gitlab-ci.yml`, reports the version delta, and leaves everything else in the file untouched.
- [ ] Run it again with no new version available; confirm it exits zero reporting "no upgrade needed."
