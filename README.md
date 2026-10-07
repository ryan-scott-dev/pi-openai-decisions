# Pi OpenAI Decisions

Use OpenAI's Decisions API through Pi's native classifier interface. This extension
registers `openai-decisions/gpt-6-luna` for `models.classify()` in codemode and
`ctx.modelRegistry.classify()` in extensions. It adds no separate tool and does not
change your chat model, route requests automatically, or approve actions.

## Requirements

- Pi 1.0.2 or later, with native classifier provider registration. Tested on Pi 1.0.2.
- Node.js 22.19.0 or later.
- An OpenAI API key with Decisions access, or credentials for a compatible proxy.
  ChatGPT/Codex subscriptions are not API credentials for this endpoint.

## Install

```sh
pi install git:github.com/ryan-scott-dev/pi-openai-decisions@main
```

While the repository is private, Git must have access to it. If you use an SSH key
registered with GitHub, use the SSH source instead:

```sh
pi install git:git@github.com:ryan-scott-dev/pi-openai-decisions@main
```

Do not put access tokens in the source URL. Install only one of these sources, then
run `/reload` in Pi. The classifier does not appear in the chat-model `/model` picker.
Use `models.getAvailableOfType("classifier")` to discover it.

The manifest declares one extension, `src/index.ts`. Remove any older local copy of
this provider from Pi's auto-discovered extensions directory to avoid loading it twice.

## Configure credentials

### Direct OpenAI

Set the key in the environment of the process that starts Pi:

```sh
export OPENAI_API_KEY="your-openai-api-key"
pi
```

The default URL is `https://api.openai.com/v1/decisions`. Alternatively, after installing
the extension, use `/login openai-decisions` to store a provider-specific API key in
Pi's auth store. Never commit credentials to this repository or put real keys in
examples.

### Compatible proxy

Merge this provider entry into `~/.pi/agent/models.json` without replacing your other
providers:

```json
{
	"providers": {
		"openai-decisions": {
			"baseUrl": "https://your-proxy.example/openai/v1",
			"apiKey": "$PROXY_API_KEY"
		}
	}
}
```

Set `PROXY_API_KEY` in Pi's environment and run `/reload`. The `baseUrl` is the API
root, not the full endpoint: include `/v1`, and the adapter appends `/decisions`.
The proxy must forward the OpenAI Decisions request and response format; support for
Chat Completions or another provider's similarly named Decisions API is not sufficient.

Pi resolves credentials at request time. Stored credentials take precedence over
`models.json` key expressions. Before switching a saved direct key to a proxy, run
`/logout`, select **OpenAI Decisions**, and remove its stored API key before making
any proxy request. The extension never reads other providers' auth files or persists
keys itself. Your existing OpenAI chat provider is unchanged.

Only use a trusted endpoint. Every call sends the full supplied JSON state and
questions to that service. Redirects are rejected.

## Enable codemode

Merge this into `~/.pi/agent/settings.json` if codemode is not already enabled:

```json
{
	"defaultTools": ["+codemode"]
}
```

`+codemode` adds the native tool without removing Pi's normal file and shell tools.
Run `/reload` after changing extension resources.

## Classify from codemode

A call batches every question about one JSON state. Boolean answers are probabilities
of true; choice answers contain a selected label and its distribution; score answers
contain the expected zero-based level index and confidence.

```js
const model = await models.getModelOfType("classifier", "openai-decisions", "gpt-6-luna");
if (!model) throw new Error("Install or reload the OpenAI Decisions extension first");

const result = await models.classify(model, {
	state: { message: "The package arrived with a broken screen." },
	questions: {
		damaged: {
			type: "bool",
			instructions: "Does the message report a damaged item?",
			criteria: { true: "Reports damage", false: "Does not report damage" },
		},
		department: {
			type: "choice",
			instructions: "Which department should handle the complaint?",
			criteria: { returns: "Damaged items and returns", billing: "Charges and invoices" },
		},
		severity: {
			type: "score",
			instructions: "How severe is the issue?",
			criteria: ["No damage", "Minor cosmetic damage", "Product is broken"],
		},
	},
});
if (result.stopReason !== "stop") throw new Error(result.errorMessage);
return result.answers;
```

Use `await models.getAvailableOfType("classifier", "openai-decisions")` to check
availability. Extension code uses the same context shape with
`await ctx.modelRegistry.classify(model, context)`.

## Behavior and limits

- JSON state is serialized as text. The adapter does not support image blocks.
- `bool` maps to OpenAI `predicate`, including both true/false criteria in its instructions.
  Choices preserve labels and descriptions; score criteria become ordered levels.
- Answers are matched by question name. A refusal or invalid answer fails the entire
  call with `stopReason: "error"` and no partial answers. Always check that status.
- Usage is retained when answer validation fails. Pi's codemode includes it in session
  token/cost totals, even if a proxy does not track this endpoint.
- The catalog estimate is $0.10/M uncached input tokens, zero output/cache charges,
  and $0.20/M input above 272K context tokens. Regional premiums are not modeled.
  Pi 1.0.2 does not apply `models.json` pricing overrides to classifiers; changing the
  estimate requires editing `DECISIONS_MODEL.cost` in `src/classifier.ts` and reloading.
  Check the current [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
  before relying on prices.
- Default timeout: 60 seconds. Extension callers can supply `timeoutMs` and an abort
  signal. There are no automatic retries or fallbacks; `temperature`, `maxRetries`,
  and `maxRetryDelayMs` are not used.
- HTTP errors report only status; malformed JSON reports a fixed error instead of
  exposing upstream response excerpts. The Decisions API is public beta, so availability
  and behavior may change.

## Update or remove

Use the exact source shown by `pi list`:

```sh
pi update git:github.com/ryan-scott-dev/pi-openai-decisions@main
pi remove git:github.com/ryan-scott-dev/pi-openai-decisions@main
```

For an SSH installation, substitute the SSH source. A `@main` source follows that
branch when explicitly updated. A commit or tag source pins a snapshot instead.
Run `/reload` after updating or removing the package. Removing it does not delete
credentials or the provider entry in `models.json`; remove those separately if needed.

## Development

Use [pnpm](https://pnpm.io/installation) 10.33.1, pinned in `packageManager`, with
Node >=22.19.0. Commit the generated `pnpm-lock.yaml`; do not create an npm lockfile.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
```

`pnpm test` runs offline adapter tests, native Pi loader/registry/codemode integration
against a local synthetic HTTP fixture, and regressions proving the lint plugin is
actually loaded and rejects violations. No API credentials are needed. The integration
helper resolves the installed development dependency without absolute runtime paths.
Development Pi dependencies are pinned to 1.0.2; a pnpm override keeps transitive
`pi-ai` consumers on that same version. Managed installs still use host Pi modules
through peer dependencies, not bundled copies.

CI uses a frozen pnpm install and runs check, typecheck, and tests on Node 22 and 24.
No build step is required: Pi loads TypeScript extensions. The package is
Git-distributed; `private: true` prevents accidental npm publishing.

### Linting and formatting

`pnpm lint` runs **Oxlint** with correctness/suspicious checks and all 18 generic
[anti-slop](https://github.com/dmmulroy/anti-slop) rules as errors, plus
`oxc/no-accumulating-spread`. Warnings also fail the check. Oxlint and `@oxlint/plugins`
are pinned together at 1.87.0. Optional Effect rules are not enabled.

Anti-slop has no official npm release. Its generic production source is vendored at
an explicit upstream revision, with license notices and [provenance](tools/oxlint/anti-slop/PROVENANCE.md).
The copy is developer tooling only, excluded from application lint/format checks and
the distributable package allowlist. Updates require reviewing upstream changes.

Narrow, explained inline exceptions preserve validation of untrusted JSON and malformed
HTTP fixtures. They do not disable rules for whole application files. The sanitized
JSON error also intentionally drops its original cause to avoid retaining private
response excerpts. Necessary type assertions state their checked invariant in a
`SAFETY:` comment; do not remove validation just to satisfy a lint rule.

`pnpm format` uses **Oxfmt**, the Oxc formatter, with tabs, a 110-column width, and import
sorting. `pnpm format:check` checks formatting without writing files; `pnpm check`
combines lint and format checking. Generated lockfiles and pinned vendor source are
not reformatted. To apply the readable-spacing rule's safe fixes, run:

```sh
pnpm exec oxlint --fix .
pnpm format
pnpm check
```

Review fixes before committing. Do not automatically rewrite non-fixable rules or
silently add broad suppressions.

### Optional live smoke test

This sends synthetic data, makes a billable request, and prints answers/usage. It is
never run by `pnpm test` or CI:

```sh
export OPENAI_DECISIONS_API_KEY="your-api-or-proxy-key"
# Optional proxy API root; otherwise uses https://api.openai.com/v1:
export OPENAI_DECISIONS_BASE_URL="https://your-proxy.example/openai/v1"
pnpm smoke
```

The smoke test does not fall back to unrelated provider credentials. Temporary config
contains only an environment-variable reference, never the key. Developers can set
`OPENAI_DECISIONS_EXTENSION_PATH` to an installed `src/index.ts` to validate that copy.

## License

MIT. See [LICENSE](LICENSE).
