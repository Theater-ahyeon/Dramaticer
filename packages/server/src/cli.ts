import { existsSync } from "node:fs";
import path from "node:path";
import { createHttpAssistantSearchClient, loadDotEnv } from "@dramaticer/core";
import { parseServerArgs, repoRoot } from "./config.js";
import { startServer } from "./server.js";

async function main(args: readonly string[]): Promise<void> {
	const envPath = path.join(repoRoot, ".env");
	if (existsSync(envPath)) {
		loadDotEnv(envPath);
	}
	const config = parseServerArgs(args);
	const running = await startServer({
		dbPath: config.dbPath,
		webRoot: config.webRoot,
		host: config.host,
		port: config.port,
		password: config.password,
		docsRoot: config.docsRoot,
		...(config.assistantWebSearch === null
			? {}
			: {
					assistantSearch: createHttpAssistantSearchClient({
						baseUrl: config.assistantWebSearch,
					}),
				}),
		channels: { path: config.channelsPath, envFile: envPath },
		images: { path: config.imagesPath, mediaDir: config.mediaDir },
	});
	console.log(`服务已启动：${running.origin}`);
	const shutdown = (): void => {
		void running.close().then(() => process.exit(0));
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
}

try {
	await main(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
