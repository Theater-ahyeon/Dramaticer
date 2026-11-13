import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_PASSWORD_ENV } from "./auth.js";

export const DEFAULT_PORT = 8787;
export const DEFAULT_HOST = "127.0.0.1";
export const SERVER_USAGE =
	"用法：dramaticer-serve [--db <路径>] [--port <端口>] [--host <地址>] [--channels <路径>] [--images <路径>] [--media-dir <路径>] [--docs-root <目录>] [--web <目录>]";

/** 仓库根目录；默认路径都从这里出发，与启动时的工作目录无关。 */
export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

export interface ServerConfig {
	readonly dbPath: string;
	readonly channelsPath: string;
	readonly imagesPath: string;
	readonly mediaDir: string;
	readonly docsRoot: string;
	readonly webRoot: string;
	readonly host: string;
	readonly port: number;
	readonly password: string | null;
}

export interface ParseServerArgsOptions {
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly cwd?: string;
}

export function parseServerArgs(
	args: readonly string[],
	options: ParseServerArgsOptions = {},
): ServerConfig {
	const env = options.env ?? process.env;
	const cwd = options.cwd ?? process.cwd();
	let dbPath = path.join(repoRoot, "data", "dramaticer.db");
	let channelsPath = path.join(repoRoot, "data", "channels.yaml");
	let imagesPath = path.join(repoRoot, "data", "images.yaml");
	let mediaDir: string | null = null;
	let docsRoot = path.join(repoRoot, "docs");
	let webRoot = path.join(repoRoot, "packages", "web", "dist");
	let host = DEFAULT_HOST;
	let port = DEFAULT_PORT;

	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index];
		if (flag === undefined) break;
		const readValue = (): string => {
			const value = args[index + 1];
			if (value === undefined || value.startsWith("--")) {
				throw new Error(`参数 ${flag} 缺少值\n${SERVER_USAGE}`);
			}
			index += 1;
			return value;
		};
		switch (flag) {
			case "--db":
				dbPath = path.resolve(cwd, readValue());
				break;
			case "--channels":
				channelsPath = path.resolve(cwd, readValue());
				break;
			case "--images":
				imagesPath = path.resolve(cwd, readValue());
				break;
			case "--media-dir":
				mediaDir = path.resolve(cwd, readValue());
				break;
			case "--docs-root":
				docsRoot = path.resolve(cwd, readValue());
				break;
			case "--web":
				webRoot = path.resolve(cwd, readValue());
				break;
			case "--host":
				host = readValue();
				break;
			case "--port":
				port = parsePort(readValue());
				break;
			default:
				throw new Error(`未知参数 ${flag}\n${SERVER_USAGE}`);
		}
	}

	const envPassword = env[SERVER_PASSWORD_ENV];
	return {
		dbPath,
		channelsPath,
		imagesPath,
		mediaDir: mediaDir ?? path.join(path.dirname(dbPath), "images"),
		docsRoot,
		webRoot,
		host,
		port,
		password:
			envPassword === undefined || envPassword.length === 0
				? null
				: envPassword,
	};
}

function parsePort(value: string): number {
	if (!/^\d+$/.test(value)) {
		throw new Error(`端口必须是整数：${value}`);
	}
	const port = Number(value);
	if (port < 1 || port > 65535) {
		throw new Error(`端口必须在 1 到 65535 之间：${value}`);
	}
	return port;
}
