# Extending Docwelder: adding a new adapter

Docwelder's core is deliberately decoupled from GitLab, Azure DevOps Wiki, and OpenRouter behind three interfaces (design decision D2). Adding a new git host, wiki backend, or LLM provider is a new adapter, not a core rewrite.

## The three interfaces

| Interface     | File                                     | MVP implementation                                     |
| ------------- | ---------------------------------------- | ------------------------------------------------------ |
| `GitHost`     | `src/adapters/git-host/interface.ts`     | `src/adapters/git-host/gitlab.ts` (GitLab)             |
| `WikiBackend` | `src/adapters/wiki-backend/interface.ts` | `src/adapters/wiki-backend/ado.ts` (Azure DevOps Wiki) |
| `LLMProvider` | `src/adapters/llm-provider/interface.ts` | `src/adapters/llm-provider/openrouter.ts` (OpenRouter) |

Each interface is a small, focused contract — read the interface file's doc comments first; they describe every method's contract precisely (e.g. `GitHost.commitAndPush` MUST append `[skip ci]` to every commit message; `WikiBackend.updatePage` MUST throw `WikiConflictError` rather than silently overwrite on an ETag mismatch).

## Steps to add a new adapter

1. **Implement the interface.** Create `src/adapters/<kind>/<name>.ts` exporting a class implementing `GitHost`/`WikiBackend`/`LLMProvider`. Accept an injectable HTTP/exec function (e.g. `fetchImpl?: typeof fetch`) in the constructor so the adapter is unit-testable without real network/process calls — every existing adapter follows this pattern.
2. **Register it.** In `src/adapters/<kind>/registry.ts`, call `xyzRegistry.register({ name: '<your-adapter-name>', requiredCredentials: [...], factory: (credentials, options) => new YourAdapter(...) })`. `requiredCredentials` are secret values resolved from a `CredentialSource` (CI environment variables for pipeline jobs, user-config fields for local commands via `MapCredentialSource`); `options` (the registry's second generic parameter) carries non-secret construction context that doesn't belong in an env var — see `WikiBackend`'s `{organization, project, wikiIdentifier}` for an example of the pattern.
3. **Wire selection into config.** Wiki/git-host/LLM selection is config-driven, not compile-time (design D2) — for MVP the choice is effectively fixed per capability, but the registry pattern (`src/adapters/registry.ts`) already supports multiple registered names per kind; extending the `type` enum in the relevant config schema (`src/config/user-config.ts` for wiki/LLM selection, or `src/config/doc-style-config.ts`'s `wiki_backend.type`) is the only schema change needed to expose a new choice to users.
4. **Add unit tests.** Every existing adapter is tested purely against injected fakes (no live GitLab project, ADO wiki, or OpenRouter account is available in CI or in a contributor's environment) — see `test/unit/adapters/*/*.test.ts` for the pattern: inject a fake `fetchImpl`/`execFileImpl` that asserts on the exact request shape (method, URL, headers, body) and returns a canned response.
5. **Document any new required CI variables or user-config fields** in this repo's README and in `docwelder init`'s post-init instructions printer (`src/commands/init.ts`), so onboarding stays accurate.

## What you should NOT need to change

Adding an adapter should never require touching `src/commands/propose.ts`, `src/commands/publish.ts`, `src/commands/init.ts`, or `src/validators/structural.ts` — those consume the interfaces, not the concrete implementations. If you find yourself needing to change one of them to add an adapter, the interface is probably missing a method; extend the interface (and every existing implementation) first.
