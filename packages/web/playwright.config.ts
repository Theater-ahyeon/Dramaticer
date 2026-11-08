import { defineConfig } from "@playwright/test";

const appPort = Number(process.env.E2E_APP_PORT ?? 4517);

export default defineConfig({
	testDir: "./e2e",
	timeout: 120_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [["list"]],
	outputDir: "../../.devloop/scratch/e2e/artifacts",
	use: {
		baseURL: `http://127.0.0.1:${appPort}`,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "off",
	},
	projects: [
		{
			name: "mobile",
			use: {
				viewport: { width: 390, height: 844 },
				isMobile: true,
				hasTouch: true,
			},
		},
		{
			name: "desktop",
			use: { viewport: { width: 1440, height: 900 } },
		},
	],
	webServer: {
		command: "node e2e/serve.mjs",
		url: `http://127.0.0.1:${appPort}/api/health`,
		reuseExistingServer: false,
		timeout: 60_000,
		env: { ...process.env, E2E_APP_PORT: String(appPort) },
	},
});
