import assert from "node:assert/strict";
import test from "node:test";

import type { ClassifierContext, ClassifierModel, ClassifierOptions } from "@earendil-works/pi-ai";

import { classify, DECISIONS_MODEL } from "../src/classifier.ts";

const model: ClassifierModel<string> = { ...DECISIONS_MODEL, baseUrl: "https://proxy.example/openai/v1/" };

const context: ClassifierContext = {
	state: { message: "The screen is broken", nested: { priority: 2 } },
	questions: {
		damaged: {
			type: "bool",
			instructions: "Is it damaged?",
			criteria: { true: "Reports damage", false: "No damage" },
		},
		team: {
			type: "choice",
			instructions: "Which team?",
			criteria: { returns: "Damaged items", billing: "Invoices" },
		},
		severity: { type: "score", instructions: "How severe?", criteria: ["No damage", "Cosmetic", "Broken"] },
	},
};

function responseBody() {
	// SAFETY: These synthetic wire fixtures deliberately allow corrupt field values; the adapter must reject them.
	return {
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
			{ type: "score", name: "severity", score: 1.8, confidence: 0.85 },
			// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Malformed wire fixtures must remain expressible for negative validation tests.
		] as Array<Record<string, unknown>>,
		usage: {
			input_tokens: 100,
			output_tokens: 0,
			total_tokens: 100,
			input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
		},
	};
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This mock HTTP response accepts malformed JSON values to exercise the adapter's boundary validation.
function options(body: unknown = responseBody(), extra: Partial<ClassifierOptions> = {}): ClassifierOptions {
	return { apiKey: "secret-test-key", fetch: async () => Response.json(body), ...extra };
}

test("sends one Decisions request with all question types and resolves answers by name", async () => {
	const body = responseBody();
	body.answers.reverse();
	let calls = 0;

	const result = await classify(
		model,
		context,
		options(body, {
			fetch: async (url, init) => {
				calls++;
				assert.equal(url, "https://proxy.example/openai/v1/decisions");
				assert.equal(init?.method, "POST");
				assert.equal(init?.redirect, "error");
				assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret-test-key");
				assert.ok(init?.signal);
				// SAFETY: The adapter serializes its request body with JSON.stringify before invoking this injected fetch.
				assert.deepEqual(JSON.parse(init?.body as string), {
					model: "gpt-6-luna",
					input: JSON.stringify(context.state),
					questions: [
						{
							name: "damaged",
							type: "predicate",
							instructions: "Is it damaged?\nTrue: Reports damage\nFalse: No damage",
						},
						{
							name: "team",
							type: "choice",
							instructions: "Which team?",
							choices: [
								{ value: "returns", description: "Damaged items" },
								{ value: "billing", description: "Invoices" },
							],
						},
						{
							name: "severity",
							type: "score",
							instructions: "How severe?",
							levels: [{ label: "No damage" }, { label: "Cosmetic" }, { label: "Broken" }],
						},
					],
				});

				return Response.json(body);
			},
		}),
	);

	assert.equal(calls, 1);
	assert.equal(result.stopReason, "stop");
	assert.deepEqual(result.answers, {
		damaged: { type: "bool", probability: 0.99 },
		team: {
			type: "choice",
			choice: "returns",
			confidence: 0.9,
			probabilities: { returns: 0.95, billing: 0.05 },
		},
		severity: { type: "score", score: 1.8, confidence: 0.85 },
	});
	assert.equal(result.usage?.input, 100);
	assert.equal(result.usage?.cost.total, 0.00001);
});

test("prices input with zero output/cache charges and honors the long-context tier", async () => {
	const body = responseBody();
	body.usage = {
		input_tokens: 300000,
		output_tokens: 7,
		total_tokens: 300007,
		input_tokens_details: { cached_tokens: 10000, cache_write_tokens: 2000 },
	};
	const result = await classify(model, context, options(body));
	assert.equal(result.stopReason, "stop");
	assert.equal(result.usage?.input, 288000);
	assert.equal(result.usage?.cacheRead, 10000);
	assert.equal(result.usage?.cacheWrite, 2000);
	assert.equal(result.usage?.totalTokens, 300007);
	assert.ok(result.usage);
	assert.ok(Math.abs(result.usage.cost.total - 0.0576) < 1e-12);
});

test("honors payload/response hooks and case-insensitive header overrides/removals", async () => {
	let seenResponse = false;

	const result = await classify(
		{ ...model, headers: { "X-Test": "model", "X-Remove": "remove" } },
		context,
		options(undefined, {
			headers: { "x-test": "caller", "x-remove": null },
			onPayload: (payload) => {
				// SAFETY: This fixture's payload hook receives the object literal constructed by the adapter before serialization.
				return { ...(payload as object), safety_identifier: "test-user" };
			},
			onResponse: (response) => {
				assert.equal(response.status, 200);
				seenResponse = true;
			},
			fetch: async (_url, init) => {
				assert.equal(new Headers(init?.headers).get("x-test"), "caller");
				assert.equal(new Headers(init?.headers).has("x-remove"), false);
				// SAFETY: The adapter's JSON.stringify call supplies a string body to this injected fetch.
				assert.equal(JSON.parse(init?.body as string).safety_identifier, "test-user");

				return Response.json(responseBody());
			},
		}),
	);

	assert.equal(result.stopReason, "stop");
	assert.equal(seenResponse, true);
});

test("fails closed on refusals or malformed answers while keeping billed usage", async () => {
	const mutations: Array<(body: ReturnType<typeof responseBody>) => void> = [
		(body) => {
			body.answers[0] = { type: "refusal", name: "damaged" };
		},
		(body) => {
			body.answers.pop();
		},
		(body) => {
			body.answers[1].name = "damaged";
		},
		(body) => {
			body.answers[0].name = "unknown";
		},
		(body) => {
			body.answers[0].probability = 1.1;
		},
		(body) => {
			body.answers[1].choice = "unknown";
		},
		(body) => {
			body.answers[1].probabilities = [{ value: "returns", probability: 1 }];
		},
		(body) => {
			body.answers[1].probabilities = [
				{ value: "returns", probability: 0.5 },
				{ value: "returns", probability: 0.5 },
			];
		},
		(body) => {
			body.answers[2].score = 3;
		},
		(body) => {
			body.answers[2].confidence = -1;
		},
	];

	for (const mutate of mutations) {
		const body = responseBody();
		mutate(body);
		const result = await classify(model, context, options(body));
		assert.equal(result.stopReason, "error", JSON.stringify(body.answers));
		assert.deepEqual(result.answers, {});
		assert.equal(result.usage?.input, 100);
	}
});

test("rejects invalid usage and invalid JSON without inventing answers", async () => {
	const body = responseBody();
	body.usage.total_tokens = 101;
	assert.equal((await classify(model, context, options(body))).stopReason, "error");

	for (const text of [
		"not json",
		"private-synthetic-record: not JSON",
		"sk-fake-partial-credential-not-a-real-token: not JSON",
	]) {
		const result = await classify(
			model,
			context,
			options(undefined, {
				apiKey: "sk-fake-partial-credential-not-a-real-token",
				fetch: async () => new Response(text),
			}),
		);

		assert.equal(result.stopReason, "error");
		assert.deepEqual(result.answers, {});
		assert.equal(result.errorMessage, "OpenAI Decisions returned invalid JSON");
	}
});

test("reports HTTP status without echoing sensitive upstream bodies and does not retry", async () => {
	let calls = 0;

	const result = await classify(
		model,
		context,
		options(undefined, {
			maxRetries: 3,
			fetch: async () => {
				calls++;

				return new Response("secret-test-key private input", { status: 403 });
			},
		}),
	);

	assert.equal(calls, 1);
	assert.equal(result.stopReason, "error");
	assert.equal(result.errorMessage, "OpenAI Decisions returned HTTP 403");

	const error = await classify(
		model,
		context,
		options(undefined, {
			fetch: async () => {
				throw new Error("network failed secret-test-key");
			},
		}),
	);

	assert.equal(error.errorMessage, "network failed [redacted]");
});

test("does not send requests with missing credentials, no questions, or underspecified questions", async () => {
	let calls = 0;

	const opts = options(undefined, {
		fetch: async () => {
			calls++;

			return Response.json(responseBody());
		},
	});

	assert.equal((await classify(model, context, { ...opts, apiKey: undefined })).stopReason, "error");

	const cases: ClassifierContext["questions"][] = [
		{},
		{ q: { type: "choice", instructions: "Pick", criteria: { only: "Only" } } },
		{ q: { type: "score", instructions: "Rate", criteria: ["Only"] } },
	];

	for (const questions of cases) {
		assert.equal((await classify(model, { state: {}, questions }, opts)).stopReason, "error");
	}

	assert.equal(calls, 0);
});

test("handles prototype-like IDs and choices as ordinary own keys", async () => {
	// SAFETY: The entries define one complete choice question; fromEntries preserves __proto__ as an own key.
	const questions = Object.fromEntries([
		[
			"__proto__",
			{
				type: "choice",
				instructions: "Pick",
				criteria: Object.fromEntries([
					["__proto__", "Prototype"],
					["constructor", "Constructor"],
				]),
			},
		],
	]) as ClassifierContext["questions"];

	const body = {
		...responseBody(),
		answers: [
			{
				type: "choice",
				name: "__proto__",
				choice: "__proto__",
				confidence: 1,
				probabilities: [
					{ value: "__proto__", probability: 1 },
					{ value: "constructor", probability: 0 },
				],
			},
		],
	};

	const result = await classify(model, { state: {}, questions }, options(body));
	assert.equal(result.stopReason, "stop");
	assert.equal(Object.hasOwn(result.answers, "__proto__"), true);
});

test("returns aborted without fetching when already cancelled", async () => {
	const controller = new AbortController();
	controller.abort();

	const result = await classify(
		model,
		context,
		options(undefined, {
			signal: controller.signal,
			fetch: async () => {
				throw new Error("should not fetch");
			},
		}),
	);

	assert.equal(result.stopReason, "aborted");
});

test("propagates in-flight cancellation and distinguishes timeout errors", { timeout: 1000 }, async () => {
	const controller = new AbortController();
	const fetchStarted = Promise.withResolvers<void>();

	const waitForAbort: NonNullable<ClassifierOptions["fetch"]> = async (_url, init) => {
		const signal = init?.signal;
		assert.ok(signal);
		signal.throwIfAborted();

		return new Promise((_resolve, reject) => {
			signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			fetchStarted.resolve();
		});
	};

	const pending = classify(
		model,
		context,
		options(undefined, { signal: controller.signal, fetch: waitForAbort }),
	);

	await fetchStarted.promise;
	controller.abort();
	assert.equal((await pending).stopReason, "aborted");
	// Keep the event loop alive while AbortSignal.timeout's unref'ed timer runs.
	const keepAlive = setTimeout(() => {}, 1000);

	try {
		const result = await classify(model, context, options(undefined, { timeoutMs: 5, fetch: waitForAbort }));
		assert.equal(result.stopReason, "error");
		assert.ok(result.errorMessage);
		assert.match(result.errorMessage, /timed out|timeout/i);
	} finally {
		clearTimeout(keepAlive);
	}
});
