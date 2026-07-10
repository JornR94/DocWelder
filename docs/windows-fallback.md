# Windows: the `docker run` fallback

`release/install.sh` refuses to run on Windows shells (Git Bash/MSYS/Cygwin) in MVP — there is no supported local wrapper for Windows yet. Run the container directly instead.

## Equivalent commands

Given a pinned version `X.Y.Z` (check [the releases feed](https://raw.githubusercontent.com/JornR94/DocWelder/main/VERSION) for the latest), the wrapper's behavior translates to:

```powershell
# docwelder init-user
docker run -it --rm `
  -v "$env:USERPROFILE\.config\docwelder:/root/.config/docwelder" `
  ghcr.io/jornr94/docwelder:X.Y.Z init-user

# docwelder init (and docwelder upgrade) — also mount the repo working directory
docker run -it --rm `
  -v "$env:USERPROFILE\.config\docwelder:/root/.config/docwelder" `
  -v "${PWD}:/workspace" -w /workspace `
  ghcr.io/jornr94/docwelder:X.Y.Z init

# docwelder --version
docker run --rm ghcr.io/jornr94/docwelder:X.Y.Z --version
```

Notes:

- `init-user` deliberately does **not** mount your working directory — it only ever touches `~/.config/docwelder/config.yaml`, per the [`user-config` spec](../openspec/changes/add-docwelder-mvp/specs/user-config/spec.md).
- To forward your editor for the mapping-editing prompt during `init`, add `-e EDITOR=notepad` (or your preferred editor) to that command.
- `docwelder propose` and `docwelder publish` run inside GitLab CI via the published CI template, not via this local flow — Windows is irrelevant to them.

A native Windows install script is out of scope for the MVP (see the proposal's Non-Goals); track future support in the project's issue tracker.
