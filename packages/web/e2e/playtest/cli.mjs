import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cliPath = require.resolve("@playwright/test/cli");
const args = process.argv.slice(2);
const result = spawnSync(
	process.execPath,
	[
		cliPath,
		"test",
		"e2e/playtest/playtest.spec.ts",
		"--project=mobile",
		...args,
	],
	{
		stdio: "inherit",
		env: { ...process.env, PLAYTEST: "1" },
	},
);
process.exit(result.status ?? 1);
