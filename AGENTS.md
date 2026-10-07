# Agent instructions

This package exposes OpenAI Decisions as a native Pi classifier. Preserve the
`openai-decisions/gpt-6-luna` identity and the `models.classify()` contract unless the
owner explicitly approves a breaking change. It must not modify chat models or
silently make decisions on the user's behalf.

## Commands

Run from the repository root with Node >=22.19.0 and pnpm 10.33.1 (pinned in `packageManager`):

```sh
pnpm install --frozen-lockfile # Install the committed public-registry lockfile
pnpm test                      # Offline adapter, native codemode, and lint-policy tests
pnpm typecheck                 # Strict TypeScript, no emitted files
pnpm lint                      # Oxlint and all generic anti-slop rules; warnings fail
pnpm format:check              # Oxfmt formatting/import checks without writing
pnpm check                     # Run lint and format checking
pnpm format                    # Rewrite formatting; rerun the checks afterward
```

CI runs check, typecheck, and tests on Node 22 and 24. No compilation/build step is
needed. `pnpm smoke` is optional and billable; it requires explicit
`OPENAI_DECISIONS_API_KEY` and optionally `OPENAI_DECISIONS_BASE_URL`. Do not run it
without owner authorization. It uses synthetic data, never repository content.

## Stack and structure

TypeScript with native Node type stripping and ESM. Pi development dependencies
are pinned to 1.0.2 in `package.json`; host Pi modules are peer dependencies at
runtime. Oxlint and `@oxlint/plugins` are pinned to matching versions; Oxfmt and
TypeScript are also pinned. `pnpm-lock.yaml` is generated. The pnpm `pi-ai` override
keeps the development SDK graph on one version; do not introduce duplicate branded
SDK types or bundle host modules.

- `src/index.ts`: one native provider registration.
- `src/classifier.ts`: model metadata, wire mapping, transport, validation, usage.
- `test/classifier.test.ts`: synthetic adapter requests, failures, and cancellation.
- `test/codemode.test.ts`: real Pi loader/registry/sandbox with local HTTP.
- `test/runtime.ts`: shared integration helper, including version-sensitive Pi internals.
- `test/tooling.test.ts`: proves anti-slop policy is configured and enforced by the CLI.
- `oxlint.config.ts` / `.oxfmtrc.json`: lint policy and formatting/import settings.
- `tools/oxlint/anti-slop/`: pinned upstream source and license/provenance; not application code.
- `scripts/smoke.ts`: explicitly opted-in live integration.
- `.github/workflows/check.yml`: offline CI gates.
- `node_modules/`: installed dependencies, never tracked or edited.

## Testing and style

Add tests for any changed request, answer, auth, cancellation, or usage behavior.
Keep `pnpm test` offline; do not add credentials or external calls to fixtures.
Native integration must fail rather than silently skip if provider registration or
codemode stops working. It must test endpoint/key overrides and session usage.

`oxlint.config.ts` and `.oxfmtrc.json` are the lint/format source of truth. All 18
generic anti-slop rules are errors, with narrowly justified inline exceptions for
wire parsing and invalid-response fixtures. Do not remove boundary validation,
attach sensitive parser errors as causes, or disable rules broadly to pass lint.
Necessary type assertions require a nearby `SAFETY:` invariant comment.

For readable-spacing fixes, run `pnpm exec oxlint --fix .`, then `pnpm format`, then
`pnpm check`; inspect the diff. Vendor source and generated lockfiles are excluded
from formatting. Preserve their provenance and do not edit them incidentally.
Keep ESM semantics consistent with `tsconfig.json`. Failures return a structured result:

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
- Update vendored anti-slop, alter rule policy, or add suppressions outside documented safety boundaries.

Never:

- Commit real credentials, private endpoints, organization-specific configuration,
  machine paths, auth files, logs, sessions, or copied personal agent instructions.
- Log upstream response bodies or credential fragments when reporting errors.
- Hand-edit `pnpm-lock.yaml`, create an npm lockfile, vendor host modules, or bypass a failing check.
