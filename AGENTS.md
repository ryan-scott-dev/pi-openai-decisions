# Agent instructions

This package exposes OpenAI Decisions as a native Pi classifier. Preserve the
`openai-decisions/gpt-6-luna` identity and the `models.classify()` contract unless the
owner explicitly approves a breaking change. It must not modify chat models or
silently make decisions on the user's behalf.

## Commands

Run from the repository root with Node >=22.19.0 and npm:

```sh
npm ci                  # Install the public-registry lockfile
npm test                # Offline adapter and native Pi codemode integration tests
npm run typecheck       # Strict TypeScript, no emitted files
npm run check           # Biome formatting, lint, and import checks
npm run format          # Rewrite formatting; rerun the checks afterward
```

CI runs check, typecheck, and tests on Node 22 and 24. No compilation/build step is
needed. `npm run smoke` is optional and billable; it requires explicit
`OPENAI_DECISIONS_API_KEY` and optionally `OPENAI_DECISIONS_BASE_URL`. Do not run it
without owner authorization. It uses synthetic data, never repository content.

## Stack and structure

TypeScript with native Node type stripping and ESM. Pi development dependencies
are pinned to 1.0.2 in `package.json`; host Pi modules are peer dependencies at
runtime. Biome and TypeScript versions are pinned; `package-lock.json` is generated.

- `src/index.ts`: one native provider registration.
- `src/classifier.ts`: model metadata, wire mapping, transport, validation, usage.
- `test/classifier.test.ts`: synthetic adapter requests, failures, and cancellation.
- `test/codemode.test.ts`: real Pi loader/registry/sandbox with local HTTP.
- `test/runtime.ts`: shared integration helper, including version-sensitive Pi internals.
- `scripts/smoke.ts`: explicitly opted-in live integration.
- `.github/workflows/check.yml`: offline CI gates.
- `node_modules/`: installed dependencies, never tracked or edited.

## Testing and style

Add tests for any changed request, answer, auth, cancellation, or usage behavior.
Keep `npm test` offline; do not add credentials or external calls to fixtures.
Native integration must fail rather than silently skip if provider registration or
codemode stops working. It must test endpoint/key overrides and session usage.

`biome.json` is the formatting/lint source of truth. Keep imports and ESM module
semantics consistent with `tsconfig.json` and the nearby code. Validate untrusted
responses at the adapter boundary. Failures return a structured classifier result:

```ts
result.stopReason = options.signal?.aborted ? "aborted" : "error";
```

Never turn a refusal, transport failure, or malformed response into a confident
answer. Preserve reported usage for billed responses even if answer validation fails.

## Git workflow

Use a topic branch for subsequent changes. Run all offline gates and review the diff
before committing. Do not push or merge into the default branch without explicit
owner permission. Repository visibility and public releases are owner decisions;
being able to access GitHub is not approval to publish.

## Boundaries

Always:
- Keep endpoint/key overrides in users' Pi configuration, not hardcoded in the package.
- Keep the repository provider-agnostic: only public service names, domains, and examples.
- Keep host Pi modules in `peerDependencies`, never runtime `dependencies`.
- Commit the generated lockfile when changing development dependencies.
- Check package contents and Git identity before sharing changes.

Ask first:
- Change model identity, request/answer semantics, pricing, authentication, or retries.
- Add dependencies, automatic classification hooks, tools, telemetry, or network tests.
- Change visibility, license, publishing configuration, or the minimum Pi/Node version.

Never:
- Commit real credentials, private endpoints, organization-specific configuration,
  machine paths, auth files, logs, sessions, or copied personal agent instructions.
- Log upstream response bodies or credential fragments when reporting errors.
- Hand-edit `package-lock.json`, vendor host modules, or bypass a failing check.
