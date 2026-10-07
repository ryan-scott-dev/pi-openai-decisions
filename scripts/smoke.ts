import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkResult, runCodemode } from "../test/runtime.ts";

// Explicit opt-in, synthetic data only. No fallback to unrelated provider credentials.
if (!process.env.OPENAI_DECISIONS_API_KEY) {
	throw new Error("Set OPENAI_DECISIONS_API_KEY before running the live smoke test");
}

const temp = await mkdtemp(join(tmpdir(), "pi-decisions-smoke-"));

try {
	const modelsPath = join(temp, "models.json");
	await writeFile(
		modelsPath,
		JSON.stringify({
			providers: {
				"openai-decisions": {
					baseUrl: process.env.OPENAI_DECISIONS_BASE_URL ?? "https://api.openai.com/v1",
					apiKey: "$OPENAI_DECISIONS_API_KEY",
				},
			},
		}),
	);
	const result = await runCodemode(modelsPath, process.env.OPENAI_DECISIONS_EXTENSION_PATH);
	console.log(checkResult(result));
} finally {
	await rm(temp, { recursive: true, force: true });
}
