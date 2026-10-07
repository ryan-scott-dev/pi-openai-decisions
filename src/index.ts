import { createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classify, DECISIONS_MODEL } from "./classifier.ts";

export default function openaiDecisions(pi: ExtensionAPI) {
	pi.registerProvider(
		createProvider({
			id: "openai-decisions",
			name: "OpenAI Decisions",
			auth: { apiKey: envApiKeyAuth("OpenAI Decisions API key", ["OPENAI_API_KEY"]) },
			models: [DECISIONS_MODEL],
			classifiers: { "openai-decisions": { classify } },
		}),
	);
}
