import { execFileSync } from "node:child_process";
import {
	cp,
	lstat,
	mkdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isJsonObject } from "@dramaticer/core";

/** ST 运行所需程序文件；第三方前端扩展与服务器插件不在兼容范围内。 */
export const DEFAULT_PROGRAM_ENTRIES: readonly string[] = [
	"server.js",
	"plugins.js",
	"recover.js",
	"index.d.ts",
	"package.json",
	"package-lock.json",
	"config.yaml",
	"webpack.config.js",
	"jsconfig.json",
	"LICENSE",
	"README.md",
	"src",
	"public",
	"default",
];

/** 驱动器需要的玩家数据子集；密钥与运行缓存不复制。 */
export const DEFAULT_DATA_ENTRIES: readonly string[] = [
	"data/default-user/OpenAI Settings",
	"data/default-user/KoboldAI Settings",
	"data/default-user/NovelAI Settings",
	"data/default-user/TextGen Settings",
	"data/default-user/characters",
	"data/default-user/worlds",
	"data/default-user/chats",
	"data/default-user/group chats",
	"data/default-user/groups",
	"data/default-user/sysprompt",
	"data/default-user/instruct",
	"data/default-user/QuickReplies",
	"data/default-user/context",
	"data/default-user/themes",
	"data/default-user/reasoning",
	"data/default-user/assets",
	"data/default-user/backgrounds",
	"data/default-user/User Avatars",
	"data/default-user/user",
];

const DENIED_BASENAMES: Record<string, true> = {
	"secrets.json": true,
	"cookie-secret.txt": true,
};

const DENIED_TOP_LEVEL: Record<string, true> = {
	".git": true,
	node_modules: true,
	backups: true,
	_cache: true,
	_errors: true,
	thumbnails: true,
	"content.log": true,
};

/** 这些相对路径整体跳过：玩家前端扩展，以及含密钥的 ST 设置文件。 */
const DENIED_PREFIXES: readonly string[] = [
	"public/scripts/extensions/third-party",
	"data/default-user/settings.json",
];

export type NodeModulesMode = "link" | "skip" | "copy";

export interface StBenchPaths {
	readonly privateRoot: string;
	readonly sandboxDir: string;
	readonly recordingsDir: string;
}

/** 测试台所有产物的默认位置；全部落在私有根目录，不能进入提交。 */
export function stBenchPaths(repoRoot: string): StBenchPaths {
	const privateRoot = path.join(repoRoot, "eval-private");
	const sandboxDir = path.join(privateRoot, "st-sandbox");
	return {
		privateRoot,
		sandboxDir,
		recordingsDir: path.join(sandboxDir, "recordings", "st"),
	};
}

export interface SillyTavernSandboxOptions {
	readonly sourceDir: string;
	/** 私有根目录；目标必须落在它里面，防止把副本写进被提交的路径。 */
	readonly privateRoot: string;
	readonly targetDir: string;
	readonly programEntries?: readonly string[];
	readonly dataEntries?: readonly string[];
	readonly nodeModules?: NodeModulesMode;
	readonly replace?: boolean;
}

export interface SillyTavernSandboxManifest {
	readonly format: "dramaticer.st-sandbox";
	readonly formatVersion: 1;
	readonly sourceDir: string;
	readonly targetDir: string;
	readonly createdAt: string;
	readonly stName: string | null;
	readonly stVersion: string | null;
	readonly license: "AGPL-3.0";
	readonly nodeModules: NodeModulesMode;
	readonly copied: readonly string[];
	readonly skipped: readonly string[];
}

/** 目标目录必须在私有根目录内部；源目录与目标目录不能互相包含。 */
export function assertSandboxTarget(
	sourceDir: string,
	privateRoot: string,
	targetDir: string,
): void {
	const source = path.resolve(sourceDir);
	const root = path.resolve(privateRoot);
	const target = path.resolve(targetDir);
	if (target === root) {
		throw new Error("沙箱目标不能就是私有根目录本身");
	}
	if (!isInside(target, root)) {
		throw new Error(`沙箱目标必须在私有根目录 ${root} 内部，收到 ${target}`);
	}
	if (isInside(target, source) || isInside(source, target)) {
		throw new Error("沙箱目标与源目录不能互相包含");
	}
}

export async function copySillyTavernSandbox(
	options: SillyTavernSandboxOptions,
): Promise<SillyTavernSandboxManifest> {
	const sourceDir = path.resolve(options.sourceDir);
	const targetDir = path.resolve(options.targetDir);
	const privateRoot = path.resolve(options.privateRoot);
	assertSandboxTarget(sourceDir, privateRoot, targetDir);

	const programEntries = options.programEntries ?? DEFAULT_PROGRAM_ENTRIES;
	const dataEntries = options.dataEntries ?? DEFAULT_DATA_ENTRIES;
	for (const entry of [...programEntries, ...dataEntries]) {
		assertRelativeEntry(entry);
	}

	if (await pathExists(targetDir)) {
		if (options.replace !== true) {
			throw new Error(`沙箱目标已存在：${targetDir}；替换时显式传入 replace`);
		}
		await rm(targetDir, { recursive: true, force: true });
	}
	await mkdir(targetDir, { recursive: true });

	const copied: string[] = [];
	const skipped: string[] = [];
	for (const entry of [...programEntries, ...dataEntries]) {
		const from = path.join(sourceDir, entry);
		if (!(await pathExists(from))) {
			skipped.push(entry);
			continue;
		}
		await cp(from, path.join(targetDir, entry), {
			recursive: true,
			force: true,
			filter: (candidate) => !isDeniedSourcePath(sourceDir, candidate),
		});
		copied.push(entry);
	}

	const nodeModules = options.nodeModules ?? "link";
	await placeNodeModules(sourceDir, targetDir, nodeModules);

	const packageJson = await readSourcePackageJson(sourceDir);
	const manifest: SillyTavernSandboxManifest = {
		format: "dramaticer.st-sandbox",
		formatVersion: 1,
		sourceDir,
		targetDir,
		createdAt: new Date().toISOString(),
		stName: packageJson.name,
		stVersion: packageJson.version,
		license: "AGPL-3.0",
		nodeModules,
		copied,
		skipped,
	};
	await writeFile(
		path.join(targetDir, "sandbox.json"),
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);
	return manifest;
}

export function isDeniedSourcePath(
	sourceDir: string,
	candidate: string,
): boolean {
	const relative = relativePosix(sourceDir, candidate);
	if (relative === "" || relative.startsWith("../")) return false;
	const segments = relative.split("/");
	const top = segments[0] ?? "";
	if (DENIED_TOP_LEVEL[top] === true) return true;
	const basename = segments[segments.length - 1] ?? "";
	if (DENIED_BASENAMES[basename] === true) return true;
	for (const prefix of DENIED_PREFIXES) {
		if (relative === prefix || relative.startsWith(`${prefix}/`)) return true;
	}
	return false;
}

function assertRelativeEntry(entry: string): void {
	if (entry.trim() === "") throw new Error("复制条目不能为空");
	if (path.isAbsolute(entry)) {
		throw new Error(`复制条目必须是相对路径，收到 ${entry}`);
	}
	const normalized = entry.replaceAll("\\", "/");
	if (normalized.split("/").includes("..")) {
		throw new Error(`复制条目不能包含 ..，收到 ${entry}`);
	}
}

async function placeNodeModules(
	sourceDir: string,
	targetDir: string,
	mode: NodeModulesMode,
): Promise<void> {
	if (mode === "skip") return;
	const from = path.join(sourceDir, "node_modules");
	const to = path.join(targetDir, "node_modules");
	if (!(await pathExists(from))) {
		throw new Error(`源目录没有 node_modules：${from}`);
	}
	if (mode === "copy") {
		await cp(from, to, { recursive: true, force: true });
		return;
	}
	const resolvedFrom = await realpath(from);
	if (process.platform === "win32") {
		execFileSync("cmd", ["/c", "mklink", "/J", to, resolvedFrom], {
			stdio: "pipe",
		});
		return;
	}
	await symlink(resolvedFrom, to, "dir");
}

async function readSourcePackageJson(
	sourceDir: string,
): Promise<{ readonly name: string | null; readonly version: string | null }> {
	const file = path.join(sourceDir, "package.json");
	if (!(await pathExists(file))) return { name: null, version: null };
	const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
	if (!isJsonObject(parsed)) return { name: null, version: null };
	const name = parsed.name;
	const version = parsed.version;
	return {
		name: typeof name === "string" ? name : null,
		version: typeof version === "string" ? version : null,
	};
}

function relativePosix(from: string, to: string): string {
	return path.relative(from, to).split(path.sep).join("/");
}

function isInside(child: string, parent: string): boolean {
	const relative = path.relative(parent, child);
	return (
		relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
	);
}

async function pathExists(target: string): Promise<boolean> {
	return lstat(target).then(
		() => true,
		() => false,
	);
}
