import type {
	ClassifierAnswer,
	ClassifierContext,
	ClassifierModel,
	ClassifierOptions,
	ClassifierQuestion,
	ClassifierResult,
	Usage,
} from "@earendil-works/pi-ai";
import { calculateCost } from "@earendil-works/pi-ai";

export const DECISIONS_MODEL: ClassifierModel<"openai-decisions"> = {
	type: "classifier",
	provider: "openai-decisions",
	id: "gpt-6-luna",
	name: "GPT-6 Luna Decisions",
	api: "openai-decisions",
	baseUrl: "https://api.openai.com/v1",
	input: ["text"],
	contextWindow: 272000,
	cost: {
		input: 0.1,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		tiers: [{ inputTokensAbove: 272000, input: 0.2, output: 0, cacheRead: 0, cacheWrite: 0 }],
	},
};

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("OpenAI Decisions returned an invalid object");
	}
	return value as Record<string, unknown>;
}

function number(value: unknown, field: string, max = Infinity): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
		throw new Error(`OpenAI Decisions returned an invalid ${field}`);
	}
	return value;
}

function wireQuestion(name: string, question: ClassifierQuestion) {
	const { instructions } = question;
	switch (question.type) {
		case "bool":
			return {
				name,
				type: "predicate",
				instructions: `${instructions}\nTrue: ${question.criteria.true}\nFalse: ${question.criteria.false}`,
			};
		case "choice": {
			const choices = Object.entries(question.criteria).map(([value, description]) => ({
				value,
				description,
			}));
			if (choices.length < 2) throw new Error(`Choice question ${name} needs at least two options`);
			return { name, type: "choice", instructions, choices };
		}
		case "score":
			if (question.criteria.length < 2) throw new Error(`Score question ${name} needs at least two levels`);
			return { name, type: "score", instructions, levels: question.criteria.map((label) => ({ label })) };
	}
}

function parseAnswer(raw: Record<string, unknown>, question: ClassifierQuestion): ClassifierAnswer {
	if (raw.type === "refusal") throw new Error("OpenAI Decisions refused a question");
	switch (question.type) {
		case "bool":
			if (raw.type !== "predicate") throw new Error("Expected a predicate answer");
			return { type: "bool", probability: number(raw.probability, "probability", 1) };
		case "choice": {
			if (
				raw.type !== "choice" ||
				typeof raw.choice !== "string" ||
				!Object.hasOwn(question.criteria, raw.choice)
			) {
				throw new Error("OpenAI Decisions returned an invalid choice");
			}
			if (!Array.isArray(raw.probabilities)) throw new Error("Expected choice probabilities");
			const entries = raw.probabilities.map((item: unknown): [string, number] => {
				const probability = record(item);
				if (typeof probability.value !== "string" || !Object.hasOwn(question.criteria, probability.value)) {
					throw new Error("OpenAI Decisions returned an unknown choice probability");
				}
				return [probability.value, number(probability.probability, "choice probability", 1)];
			});
			if (
				entries.length !== Object.keys(question.criteria).length ||
				new Set(entries.map(([key]) => key)).size !== entries.length
			) {
				throw new Error("OpenAI Decisions returned incomplete or duplicate choice probabilities");
			}
			return {
				type: "choice",
				choice: raw.choice,
				probabilities: Object.fromEntries(entries),
				confidence: number(raw.confidence, "confidence", 1),
			};
		}
		case "score":
			if (raw.type !== "score") throw new Error("Expected a score answer");
			return {
				type: "score",
				score: number(raw.score, "score", question.criteria.length - 1),
				confidence: number(raw.confidence, "confidence", 1),
			};
	}
}

function parseUsage(value: unknown, model: ClassifierModel<string>): Usage {
	const raw = record(value);
	const totalInput = number(raw.input_tokens, "input tokens");
	const output = number(raw.output_tokens, "output tokens");
	const details = record(raw.input_tokens_details);
	const cacheRead = number(details.cached_tokens, "cached tokens", totalInput);
	const cacheWrite = number(details.cache_write_tokens, "cache-write tokens", totalInput - cacheRead);
	const totalTokens = number(raw.total_tokens, "total tokens");
	if (
		![totalInput, output, cacheRead, cacheWrite, totalTokens].every(Number.isSafeInteger) ||
		totalTokens !== totalInput + output
	) {
		throw new Error("OpenAI Decisions returned inconsistent token usage");
	}
	const usage: Usage = {
		input: totalInput - cacheRead - cacheWrite,
		output,
		cacheRead,
		cacheWrite,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	calculateCost(model, usage);
	return usage;
}

export async function classify(
	model: ClassifierModel<string>,
	context: ClassifierContext,
	options: ClassifierOptions = {},
): Promise<ClassifierResult> {
	const result: ClassifierResult = {
		api: model.api,
		provider: model.provider,
		model: model.id,
		answers: {},
		stopReason: "stop",
		timestamp: Date.now(),
	};
	try {
		options.signal?.throwIfAborted();
		if (!options.apiKey) throw new Error(`No API key for provider: ${model.provider}`);
		const questions = Object.entries(context.questions);
		if (questions.length === 0) throw new Error("At least one classifier question is required");
		let payload: unknown = {
			model: model.id,
			input: JSON.stringify(context.state),
			questions: questions.map(([name, question]) => wireQuestion(name, question)),
		};
		const transformed = await options.onPayload?.(payload, model);
		if (transformed !== undefined) payload = transformed;
		const headers = new Headers({
			authorization: `Bearer ${options.apiKey}`,
			"content-type": "application/json",
		});
		for (const source of [model.headers, options.headers]) {
			for (const [name, value] of Object.entries(source ?? {})) {
				if (value === null) headers.delete(name);
				else headers.set(name, value);
			}
		}
		const timeout = AbortSignal.timeout(options.timeoutMs ?? 60000);
		const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
		const response = await (options.fetch ?? globalThis.fetch)(
			`${model.baseUrl.replace(/\/+$/, "")}/decisions`,
			{
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal,
				redirect: "error",
			},
		);
		await options.onResponse?.(
			{ status: response.status, headers: Object.fromEntries(response.headers) },
			model,
		);
		if (!response.ok) {
			await response.body?.cancel();
			// Upstream error bodies may echo input or credentials. Report only the HTTP status.
			throw new Error(`OpenAI Decisions returned HTTP ${response.status}`);
		}
		let decoded: unknown;
		try {
			decoded = await response.json();
		} catch (error) {
			if (error instanceof SyntaxError) throw new Error("OpenAI Decisions returned invalid JSON");
			throw error;
		}
		const body = record(decoded);
		// Even refused or malformed answers can be billed.
		result.usage = parseUsage(body.usage, model);
		if (!Array.isArray(body.answers) || body.answers.length !== questions.length)
			throw new Error("OpenAI Decisions returned an unexpected answer count");
		const byName = new Map<string, Record<string, unknown>>();
		for (const item of body.answers) {
			const answer = record(item);
			if (
				typeof answer.name !== "string" ||
				!Object.hasOwn(context.questions, answer.name) ||
				byName.has(answer.name)
			) {
				throw new Error("OpenAI Decisions returned an unknown or duplicate question name");
			}
			byName.set(answer.name, answer);
		}
		result.answers = Object.fromEntries(
			questions.map(([name, question]) => [name, parseAnswer(record(byName.get(name)), question)]),
		);
	} catch (error) {
		result.stopReason = options.signal?.aborted ? "aborted" : "error";
		const message = error instanceof Error ? error.message : "OpenAI Decisions request failed";
		result.errorMessage = options.apiKey ? message.replaceAll(options.apiKey, "[redacted]") : message;
	}
	return result;
}
