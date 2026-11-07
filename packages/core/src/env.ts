import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * 读取 .env 并写入 process.env。
 *
 * 文件里的值覆盖进程已有的同名变量：项目的渠道配置以 .env 为准，
 * 避免外部环境里残留的同名变量悄悄改变模型或密钥。
 */
export function loadDotEnv(envPath: string): void {
	if (!existsSync(envPath)) {
		throw new Error(`没有找到 .env 文件：${envPath}`);
	}
	const values = parseEnv(readFileSync(envPath, "utf8"));
	for (const [name, value] of Object.entries(values)) {
		process.env[name] = value;
	}
}
