import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkResult, runCodemode } from "./runtime.ts";

test("Pi loads the classifier and codemode resolves proxy auth and accounts for usage", {
	timeout: 15000,
}, async () => {
	const temp = await mkdtemp(join(tmpdir(), "pi-decisions-http-"));
	let calls = 0;
	const server = createServer(async (req, res) => {
		try {
			assert.equal(req.url, "/openai/v1/decisions");
			assert.equal(req.headers.authorization, "Bearer test-key");
			let input = "";
			for await (const chunk of req) input += chunk;
			const payload = JSON.parse(input);
			assert.equal(payload.model, "gpt-6-luna");
			assert.deepEqual(
				payload.questions.map((question: { type: string }) => question.type),
				["predicate", "choice", "score"],
			);
			calls++;
			res.setHeader("content-type", "application/json");
			res.end(
				JSON.stringify({
					model: "gpt-6-luna",
					answers: [
						{ type: "predicate", name: "damaged", probability: 0.99 },
						{
							type: "choice",
							name: "team",
							choice: "returns",
							confidence: 0.9,
							probabilities: [
								{ value: "returns", probability: 0.95 },
								{ value: "billing", probability: 0.05 },
							],
						},
						{ type: "score", name: "severity", score: 1.8, confidence: 0.8 },
					],
					usage: {
						input_tokens: 100,
						output_tokens: 0,
						total_tokens: 100,
						input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
					},
				}),
			);
		} catch (error) {
			res.statusCode = 500;
			res.end(String(error));
		}
	});
	try {
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		assert.ok(address && typeof address === "object");
		const modelsPath = join(temp, "models.json");
		await writeFile(
			modelsPath,
			JSON.stringify({
				providers: {
					"openai-decisions": {
						baseUrl: `http://127.0.0.1:${address.port}/openai/v1`,
						apiKey: "test-key",
					},
				},
			}),
		);
		checkResult(await runCodemode(modelsPath));
		assert.equal(calls, 1);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(temp, { recursive: true, force: true });
	}
});
