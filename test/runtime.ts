import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
export const extensionPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const script = `
const model = await models.getModelOfType("classifier", "openai-decisions", "gpt-6-luna");
if (!model) throw new Error("Classifier was not registered");
const available = await models.getAvailableOfType("classifier", "openai-decisions");
if (!available.some(m => m.id === model.id)) throw new Error("Classifier unavailable");
const result = await models.classify(model, {
  state: { message: "The package arrived with a broken screen." },
  questions: {
    damaged: { type: "bool", instructions: "Does the message report damage?", criteria: { true: "Reports damage", false: "No damage" } },
    team: { type: "choice", instructions: "Which team should handle it?", criteria: { returns: "Damaged items", billing: "Invoices" } },
    severity: { type: "score", instructions: "How severe?", criteria: ["No damage", "Cosmetic damage", "Broken product"] }
  }
});
if (result.stopReason !== "stop") throw new Error(result.errorMessage);
return { answers: result.answers, usage: result.usage };
`;

// Pi 1.0.2 exposes these test surfaces only through its distribution paths.
// Resolve them from the installed package, never a machine-specific directory.
export async function runCodemode(modelsPath: string, sourcePath = extensionPath) {
	const loader = await import(pathToFileURL(join(packageRoot, "dist/core/extensions/loader.js")).href);
	const codemode = await import(pathToFileURL(join(packageRoot, "dist/extensions/codemode/execute.js")).href);
	const temp = await mkdtemp(join(tmpdir(), "pi-decisions-runtime-"));
	try {
		const loaded = await loader.loadExtensions([sourcePath], dirname(sourcePath));
		assert.deepEqual(loaded.errors, []);
		assert.equal(loaded.runtime.pendingNativeProviderRegistrations.length, 1);
		const models = await ModelRuntime.create({
			modelsPath,
			authPath: join(temp, "auth.json"),
			modelsStorePath: join(temp, "models-store.json"),
			refreshOnCreate: false,
			allowModelNetwork: false,
		});
		const registry = new ModelRegistry(models);
		for (const { provider } of loaded.runtime.pendingNativeProviderRegistrations)
			registry.registerProvider(provider);
		assert.equal(
			registry.getAll().some((model) => model.provider === "openai-decisions"),
			false,
		);
		return await codemode.executeCodemode(
			"decisions-smoke",
			{ code: script },
			undefined,
			undefined,
			{ tools: [], modelRegistry: registry, sessionManager: { getBranch: () => [] } },
			{ models: true },
		);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}

export function checkResult(result: {
	isError?: boolean;
	content: Array<{ type: string; text?: string }>;
	usage?: { totalTokens: number; cost: { total: number } };
}) {
	const text = result.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
	assert.equal(result.isError, undefined, text);
	assert.match(text, /Script completed/);
	assert.match(text, /"damaged"/);
	assert.match(text, /"team"/);
	assert.match(text, /"severity"/);
	assert.ok(result.usage && result.usage.totalTokens > 0);
	assert.ok(result.usage.cost.total > 0);
	return text;
}
