import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import config from "../oxlint.config.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

const configPath = join(root, "oxlint.config.ts");

const cliPath = fileURLToPath(new URL("./bin/oxlint", import.meta.resolve("oxlint/package.json")));

test("all 18 generic anti-slop rules and accumulating-spread checks are errors", () => {
	const rules = config.rules ?? {};
	let genericRules = 0;

	for (const [name, severity] of Object.entries(rules)) {
		if (name.startsWith("anti-slop/")) {
			genericRules++;
			assert.equal(severity, "error", name);
		}
	}

	assert.equal(genericRules, 18);
	assert.equal(rules["oxc/no-accumulating-spread"], "error");
});

test(
	"the configured Oxlint plugin rejects slop and accepts a clean fixture",
	{ timeout: 15000 },
	async () => {
		const temp = await mkdtemp(join(tmpdir(), "pi-decisions-lint-"));

		try {
			const cases = [
				{ source: "export const result = [1, 2, 3];\n", rule: null },
				{
					source: "export const result = [1, 2, 3].filter(value => value > 1).map(value => value * 2);\n",
					rule: "no-array-filter-map",
				},
				{ source: "export const result = 1 as number;\n", rule: "require-safety-comment-for-type-assertion" },
			];

			for (const [index, fixture] of cases.entries()) {
				const path = join(temp, `probe-${index}.ts`);
				await writeFile(path, fixture.source);

				const result = spawnSync(
					process.execPath,
					[cliPath, "--config", configPath, "--deny-warnings", "--no-ignore", path],
					{
						cwd: root,
						encoding: "utf8",
						timeout: 10000,
					},
				);

				assert.ifError(result.error);
				const output = result.stdout + result.stderr;

				if (fixture.rule === null) assert.equal(result.status, 0, output);
				else {
					assert.equal(result.status, 1, output);
					assert.ok(output.includes(`anti-slop(${fixture.rule})`), output);
				}
			}
		} finally {
			await rm(temp, { recursive: true, force: true });
		}
	},
);
