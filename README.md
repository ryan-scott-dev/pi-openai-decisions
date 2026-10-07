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
      criteria: { true: "Reports damage", false: "Does not report damage" }
    },
    department: {
      type: "choice",
      instructions: "Which department should handle the complaint?",
      criteria: { returns: "Damaged items and returns", billing: "Charges and invoices" }
    },
    severity: {
      type: "score",
      instructions: "How severe is the issue?",
      criteria: ["No damage", "Minor cosmetic damage", "Product is broken"]
    }
  }
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

```sh
npm ci
npm test
npm run typecheck
npm run check
```

`npm test` runs offline unit tests and native Pi loader/registry/codemode integration
against a local synthetic HTTP fixture. It does not need API credentials. The integration
helper resolves the installed development dependency, so no absolute runtime path or
optional environment variable is required. Development Pi dependencies are pinned to
1.0.2; managed installs use the host Pi packages through peer dependencies.

Use `npm run format` to format files, then rerun the checks. CI runs check, typecheck,
and tests on Node 22 and 24. No build step is required: Pi loads TypeScript extensions.
The package is Git-distributed; `private: true` prevents accidental npm publishing.

### Optional live smoke test

This sends synthetic data, makes a billable request, and prints answers/usage. It is
never run by `npm test` or CI:

```sh
export OPENAI_DECISIONS_API_KEY="your-api-or-proxy-key"
# Optional proxy API root; otherwise uses https://api.openai.com/v1:
export OPENAI_DECISIONS_BASE_URL="https://your-proxy.example/openai/v1"
npm run smoke
```

The smoke test does not fall back to unrelated provider credentials. Temporary config
contains only an environment-variable reference, never the key. Developers can set
`OPENAI_DECISIONS_EXTENSION_PATH` to an installed `src/index.ts` to validate that copy.

## License

MIT. See [LICENSE](LICENSE).
