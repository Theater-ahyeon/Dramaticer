import { existsSync } from "node:fs";

export function loadDotEnv(envPath: string): void {
	if (!existsSync(envPath)) {
		throw new Error(`没有找到 .env 文件：${envPath}`);
	}
	process.loadEnvFile(envPath);
}
