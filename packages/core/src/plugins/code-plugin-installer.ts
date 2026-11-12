import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import { gt, maxSatisfying } from "semver";
import { x as extractTar } from "tar";
import type { JsonValue } from "../json.js";
import {
	type CodePluginLedgerSink,
	type CodePluginModelHandler,
	type CodePluginRuntime,
	type CodePluginRuntimeStatus,
	type CodePluginTraceEntry,
	startCodePluginRuntime,
} from "./code-plugin-worker.js";
import {
	type CodePluginManifest,
	type CodePluginPermissionChange,
	assertCodePluginRelativePath,
	isEngineCompatible,
	parseCodePluginManifest,
} from "./code-plugins.js";
import {
	type CodePluginInstallPlan,
	type CodePluginInstallSource,
	type CodePluginInstallationRecord,
	type CodePluginInstallationStore,
	assertCodePluginInstallSource,
	confirmCodePluginInstallation,
	planCodePluginInstallation,
} from "./installation.js";
import type { ExtensionRegistry } from "./registry.js";
import { assertInstalledVersion } from "./versions.js";

/** 插件目录根下的清单文件名；三种来源解包后都必须在这里提供。 */
export const CODE_PLUGIN_MANIFEST_FILENAME = "dramaticer.plugin.json";

const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org";
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const NPM_NAME_PATTERN = /^[a-z0-9][a-z0-9._~-]*$/;

const execFileAsync = promisify(execFile);

/**
 * 一次安装准备：已经把来源解包到暂存目录并读了清单。调用方先展示
 * `plan.added` 与 `plan.removed`，用户确认之后再调用 `confirm`。
 */
export interface CodePluginInstallPreparation {
	readonly source: CodePluginInstallSource;
	readonly manifest: CodePluginManifest;
	readonly plan: CodePluginInstallPlan;
	/** 清单声明的本机版本范围是否包含当前版本。 */
	readonly compatible: boolean;
	/** 不兼容时的提示文案；兼容时为 null。 */
	readonly message: string | null;
	/** 解包目录；不兼容或已经确认安装后为 null。 */
	readonly stagedDir: string | null;
}

/** 更新检查结果；只读，不写入任何记录，也不改动插件目录。 */
export interface CodePluginUpdateCheck {
	readonly name: string;
	readonly currentVersion: string;
	readonly latestVersion: string;
	/** 来源提供的版本高于已安装版本。 */
	readonly updateAvailable: boolean;
	readonly compatible: boolean;
	/** 可以直接展示的结论：有新版本、已是最新、版本更低或本机不兼容。 */
	readonly message: string;
	readonly added: readonly CodePluginPermissionChange[];
	readonly removed: readonly CodePluginPermissionChange[];
	readonly requiresConfirmation: boolean;
}

export interface CodePluginManagerOptions {
	readonly pluginsDir: string;
	readonly store: CodePluginInstallationStore;
	/** 本机 Dramaticer 版本，用来判断清单声明的兼容范围。 */
	readonly engineVersion: string;
	/** 暂存目录；默认是插件目录下的 `.staging`，与安装目录同卷。 */
	readonly stagingDir?: string;
	/** npm 来源使用的 registry；可用本地服务替换。 */
	readonly npmRegistry?: string;
	/** npm 元数据与 tarball 下载实现；默认使用全局 fetch。 */
	readonly registryFetch?: typeof fetch;
	/** 插件网络能力使用的实现；与 registry 下载分开，便于分别测试。 */
	readonly pluginFetch?: typeof fetch;
	/** 插件注册的扩展点进入这个注册表。 */
	readonly registry?: ExtensionRegistry;
	readonly model?: CodePluginModelHandler;
	readonly ledger?: CodePluginLedgerSink;
	readonly onTrace?: (entry: CodePluginTraceEntry) => void;
	/** git clone 等外部命令的超时；超时按失败处理。 */
	readonly commandTimeoutMs?: number;
}

export interface CodePluginStartOptions {
	readonly config?: JsonValue;
	readonly activationTimeoutMs?: number;
	readonly invokeTimeoutMs?: number;
}

interface NpmPackageMetadata {
	readonly "dist-tags"?: Record<string, string>;
	readonly versions?: Record<
		string,
		{
			readonly dist?: {
				readonly tarball?: string;
				readonly integrity?: string;
			};
		}
	>;
}

/**
 * 代码插件的安装、更新与卸载入口。来源先解包到暂存目录并读清单，
 * 安装记录与权限确认复用 P4.b 的计划函数；运行中的 worker 由这里
 * 统一持有，卸载时先停止再删除文件与记录。
 */
export class CodePluginManager {
	private readonly pluginsDir: string;
	private readonly stagingRoot: string;
	private readonly store: CodePluginInstallationStore;
	private readonly engineVersion: string;
	private readonly npmRegistry: string;
	private readonly registryFetch: typeof fetch;
	private readonly pluginFetch: typeof fetch | undefined;
	private readonly commandTimeoutMs: number;
	private readonly runtimes = new Map<string, CodePluginRuntime>();

	constructor(options: CodePluginManagerOptions) {
		this.pluginsDir = resolve(options.pluginsDir);
		this.stagingRoot = resolve(
			options.stagingDir ?? join(this.pluginsDir, ".staging"),
		);
		this.store = options.store;
		assertInstalledVersion(options.engineVersion, "engineVersion");
		this.engineVersion = options.engineVersion;
		this.npmRegistry = (options.npmRegistry ?? DEFAULT_NPM_REGISTRY).replace(
			/\/+$/,
			"",
		);
		this.registryFetch = options.registryFetch ?? globalThis.fetch;
		this.pluginFetch = options.pluginFetch;
		this.commandTimeoutMs =
			options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
		if (
			!Number.isInteger(this.commandTimeoutMs) ||
			this.commandTimeoutMs <= 0
		) {
			throw new Error("commandTimeoutMs 必须是正整数毫秒");
		}
		this.runtimeOptions = {
			registry: options.registry,
			fetch: options.pluginFetch,
			model: options.model,
			ledger: options.ledger,
			onTrace: options.onTrace,
		};
	}

	private readonly runtimeOptions: {
		readonly registry?: ExtensionRegistry;
		readonly fetch?: typeof fetch;
		readonly model?: CodePluginModelHandler;
		readonly ledger?: CodePluginLedgerSink;
		readonly onTrace?: (entry: CodePluginTraceEntry) => void;
	};

	/** 插件安装目录；插件名不能带路径分隔符，因此目录固定在根下。 */
	pluginDir(name: string): string {
		if (!PLUGIN_NAME_PATTERN.test(name)) {
			throw new Error(`插件名不合法：${name}`);
		}
		return join(this.pluginsDir, name);
	}

	installed(): readonly CodePluginInstallationRecord[] {
		return this.store.listCodePluginInstallations();
	}

	/** 读取插件目录下的全部清单，供启动核对复用。 */
	readInstalledManifests(): CodePluginManifest[] {
		if (!existsSync(this.pluginsDir)) return [];
		const manifests: CodePluginManifest[] = [];
		const entries = readdirSync(this.pluginsDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
			const manifestPath = join(
				this.pluginsDir,
				entry.name,
				CODE_PLUGIN_MANIFEST_FILENAME,
			);
			if (!existsSync(manifestPath)) continue;
			manifests.push(
				this.readManifestFile(manifestPath, `插件 ${entry.name} 的清单`),
			);
		}
		return manifests.sort((left, right) => left.name.localeCompare(right.name));
	}

	/**
	 * 解包来源、读取清单并计算权限计划。本机版本不在清单声明的范围内时
	 * 返回 `compatible: false` 与提示，暂存目录立即删除，不留下半装状态。
	 */
	async prepare(
		source: CodePluginInstallSource,
	): Promise<CodePluginInstallPreparation> {
		const installSource = assertCodePluginInstallSource(source);
		mkdirSync(this.stagingRoot, { recursive: true });
		const stagedDir = mkdtempSync(join(this.stagingRoot, "staging-"));
		try {
			await this.materialize(installSource, stagedDir);
			const manifest = this.readManifestFile(
				join(stagedDir, CODE_PLUGIN_MANIFEST_FILENAME),
				"插件清单",
			);
			const plan = planCodePluginInstallation(
				this.store,
				manifest,
				installSource,
			);
			if (!isEngineCompatible(manifest.engine, this.engineVersion)) {
				rmSync(stagedDir, { recursive: true, force: true });
				return {
					source: installSource,
					manifest,
					plan,
					compatible: false,
					message: `插件 ${manifest.name} 要求 Dramaticer ${manifest.engine}，当前版本 ${this.engineVersion}`,
					stagedDir: null,
				};
			}
			return {
				source: installSource,
				manifest,
				plan,
				compatible: true,
				message: null,
				stagedDir,
			};
		} catch (error) {
			rmSync(stagedDir, { recursive: true, force: true });
			throw error;
		}
	}

	/** 放弃一次安装准备，删除暂存目录。 */
	cancel(preparation: CodePluginInstallPreparation): void {
		if (preparation.stagedDir === null) return;
		this.assertInsideStaging(preparation.stagedDir);
		rmSync(preparation.stagedDir, { recursive: true, force: true });
	}

	/**
	 * 用户在看过权限计划后确认安装。先把旧目录移到暂存区作为备份，
	 * 新目录就位后再写安装记录；任何一步失败都恢复旧目录。
	 */
	async confirm(
		preparation: CodePluginInstallPreparation,
		options: { readonly installedAt?: string } = {},
	): Promise<CodePluginInstallationRecord> {
		if (!preparation.compatible || preparation.stagedDir === null) {
			throw new Error(
				preparation.message ??
					`插件 ${preparation.manifest.name} 与当前版本不兼容，不能安装`,
			);
		}
		this.assertInsideStaging(preparation.stagedDir);
		if (this.runtimes.has(preparation.manifest.name)) {
			throw new Error(`插件正在运行，请先停止：${preparation.manifest.name}`);
		}
		const pluginDir = this.pluginDir(preparation.manifest.name);
		mkdirSync(dirname(pluginDir), { recursive: true });
		const backupDir = join(this.stagingRoot, `backup-${randomUUID()}`);
		const hadExisting = existsSync(pluginDir);
		if (hadExisting) renameSync(pluginDir, backupDir);
		try {
			renameSync(preparation.stagedDir, pluginDir);
		} catch (error) {
			if (hadExisting) renameSync(backupDir, pluginDir);
			throw error;
		}
		try {
			const record = confirmCodePluginInstallation(
				this.store,
				preparation.plan,
				options,
			);
			rmSync(backupDir, { recursive: true, force: true });
			return record;
		} catch (error) {
			rmSync(pluginDir, { recursive: true, force: true });
			if (hadExisting) renameSync(backupDir, pluginDir);
			throw error;
		}
	}

	/**
	 * 重新解包安装来源并比较版本。来源不可达、清单不合法或本机版本
	 * 不兼容时给出结论，不改动已安装目录与记录。
	 */
	async checkUpdate(name: string): Promise<CodePluginUpdateCheck> {
		const record = this.store.getCodePluginInstallation(name);
		if (record === null) {
			throw new Error(`插件没有安装记录：${name}`);
		}
		const preparation = await this.prepare(record.source);
		try {
			const latestVersion = preparation.manifest.version;
			const updateAvailable =
				preparation.compatible && gt(latestVersion, record.version);
			let message: string;
			if (!preparation.compatible) {
				message = preparation.message ?? `插件 ${name} 与当前版本不兼容`;
			} else if (updateAvailable) {
				message = `发现新版本 ${latestVersion}（当前 ${record.version}）`;
			} else if (latestVersion === record.version) {
				message = `已是最新版本 ${record.version}`;
			} else {
				message = `来源提供的版本 ${latestVersion} 低于已安装版本 ${record.version}`;
			}
			return {
				name,
				currentVersion: record.version,
				latestVersion,
				updateAvailable,
				compatible: preparation.compatible,
				message,
				added: preparation.plan.added,
				removed: preparation.plan.removed,
				requiresConfirmation: preparation.plan.requiresConfirmation,
			};
		} finally {
			this.cancel(preparation);
		}
	}

	/** 启动一个已安装插件；激活失败返回 failed 状态，不从安装目录推断权限。 */
	async start(
		name: string,
		options: CodePluginStartOptions = {},
	): Promise<CodePluginRuntime> {
		if (this.runtimes.has(name)) {
			throw new Error(`插件已经在运行：${name}`);
		}
		const record = this.store.getCodePluginInstallation(name);
		if (record === null) {
			throw new Error(`插件没有安装记录：${name}`);
		}
		const runtime = await startCodePluginRuntime({
			pluginDir: this.pluginDir(name),
			manifest: record.manifest,
			grantedPermissions: record.grantedPermissions,
			config: options.config,
			activationTimeoutMs: options.activationTimeoutMs,
			invokeTimeoutMs: options.invokeTimeoutMs,
			...this.runtimeOptions,
		});
		if (runtime.state === "failed") {
			return runtime;
		}
		this.runtimes.set(name, runtime);
		return runtime;
	}

	/** 停止插件并撤销它的全部注册项；没有运行时是安全的。 */
	async stop(name: string): Promise<void> {
		const runtime = this.runtimes.get(name);
		if (runtime === undefined) return;
		this.runtimes.delete(name);
		await runtime.dispose();
	}

	/** 运行中的插件；不在运行或已经失败时返回 null。 */
	runtime(name: string): CodePluginRuntime | null {
		return this.runtimes.get(name) ?? null;
	}

	runtimeStatuses(): readonly CodePluginRuntimeStatus[] {
		return [...this.runtimes.values()].map((runtime) => runtime.status);
	}

	/**
	 * 卸载：先停 worker 并撤销注册项，再删除插件目录与安装记录。
	 * 目录缺失但记录存在时只删记录，记录缺失但目录存在时只删目录。
	 */
	async uninstall(name: string): Promise<void> {
		const record = this.store.getCodePluginInstallation(name);
		const pluginDir = this.pluginDir(name);
		const dirExists = existsSync(pluginDir);
		if (record === null && !dirExists) {
			throw new Error(`插件没有安装：${name}`);
		}
		await this.stop(name);
		if (dirExists) rmSync(pluginDir, { recursive: true, force: true });
		if (record !== null) this.store.deleteCodePluginInstallation(name);
	}

	private async materialize(
		source: CodePluginInstallSource,
		targetDir: string,
	): Promise<void> {
		switch (source.kind) {
			case "npm":
				await this.materializeNpm(source.spec, targetDir);
				return;
			case "git":
				await this.materializeGit(source.spec, targetDir);
				return;
			case "zip":
				this.materializeZip(source.spec, targetDir);
				return;
		}
	}

	private async materializeNpm(spec: string, targetDir: string): Promise<void> {
		const { name, wanted } = parseNpmSpec(spec);
		const encoded = name.startsWith("@")
			? name.replace("/", "%2f")
			: encodeURIComponent(name);
		const response = await this.registryFetch(
			`${this.npmRegistry}/${encoded}`,
			{ headers: { accept: "application/json" } },
		);
		if (!response.ok) {
			throw new Error(
				`读取 npm 包 ${name} 的元数据失败：HTTP ${response.status}`,
			);
		}
		const metadata = (await response.json()) as NpmPackageMetadata;
		const version = resolveNpmVersion(metadata, name, wanted);
		const dist = metadata.versions?.[version]?.dist;
		if (dist === undefined || typeof dist.tarball !== "string") {
			throw new Error(`npm 包 ${name}@${version} 没有可下载的 tarball`);
		}
		const tarballResponse = await this.registryFetch(dist.tarball);
		if (!tarballResponse.ok) {
			throw new Error(
				`下载 npm 包 ${name}@${version} 失败：HTTP ${tarballResponse.status}`,
			);
		}
		const bytes = new Uint8Array(await tarballResponse.arrayBuffer());
		verifyNpmIntegrity(dist.integrity, bytes, `${name}@${version}`);
		const tarballPath = join(this.stagingRoot, `npm-${randomUUID()}.tgz`);
		writeFileSync(tarballPath, bytes);
		try {
			await extractNpmTarball(tarballPath, targetDir);
		} finally {
			rmSync(tarballPath, { force: true });
		}
	}

	private async materializeGit(spec: string, targetDir: string): Promise<void> {
		await execFileAsync(
			"git",
			["clone", "--depth", "1", "--quiet", "--", spec, targetDir],
			{ timeout: this.commandTimeoutMs, windowsHide: true },
		);
		rmSync(join(targetDir, ".git"), { recursive: true, force: true });
	}

	private materializeZip(spec: string, targetDir: string): void {
		const bytes = new Uint8Array(readFileSync(spec));
		let entries: Record<string, Uint8Array>;
		try {
			entries = unzipSync(bytes);
		} catch (error) {
			throw new Error(`zip 文件无法解析：${errorText(error)}`);
		}
		for (const [entryName, content] of Object.entries(entries)) {
			if (entryName.endsWith("/")) {
				const directory = readZipEntryPath(targetDir, entryName.slice(0, -1));
				mkdirSync(directory, { recursive: true });
				continue;
			}
			const target = readZipEntryPath(targetDir, entryName);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, content);
		}
	}

	private readManifestFile(path: string, label: string): CodePluginManifest {
		if (!existsSync(path)) {
			throw new Error(`${label} 缺少 ${CODE_PLUGIN_MANIFEST_FILENAME}`);
		}
		let value: unknown;
		try {
			value = JSON.parse(readFileSync(path, "utf8"));
		} catch (error) {
			throw new Error(`${label} 不是合法 JSON：${errorText(error)}`);
		}
		return parseCodePluginManifest(value, label);
	}

	private assertInsideStaging(path: string): void {
		const resolved = resolve(path);
		if (
			resolved !== this.stagingRoot &&
			!resolved.startsWith(this.stagingRoot + sep)
		) {
			throw new Error(`暂存路径不在暂存目录内：${path}`);
		}
	}
}

/** 解析 npm 来源说明：`name`、`name@1.2.3`、`@scope/name@^1.0.0`。 */
export function parseNpmSpec(spec: string): {
	readonly name: string;
	readonly wanted: string;
} {
	if (spec.trim() !== spec || spec.length === 0) {
		throw new Error(`npm 来源说明不能带首尾空白：${spec}`);
	}
	if (spec.startsWith("@")) {
		const slash = spec.indexOf("/");
		if (slash < 0) {
			throw new Error(`npm 来源缺少包名：${spec}`);
		}
		const at = spec.indexOf("@", slash);
		const name = at < 0 ? spec : spec.slice(0, at);
		const wanted = at < 0 ? "" : spec.slice(at + 1);
		assertNpmName(name);
		return { name, wanted };
	}
	const at = spec.indexOf("@");
	const name = at < 0 ? spec : spec.slice(0, at);
	const wanted = at < 0 ? "" : spec.slice(at + 1);
	assertNpmName(name);
	return { name, wanted };
}

function assertNpmName(name: string): void {
	if (name.startsWith("@")) {
		const [scope, packageName, extra] = name.slice(1).split("/");
		if (
			extra !== undefined ||
			scope === undefined ||
			packageName === undefined ||
			!NPM_NAME_PATTERN.test(scope) ||
			!NPM_NAME_PATTERN.test(packageName)
		) {
			throw new Error(`npm 包名不合法：${name}`);
		}
		return;
	}
	if (!NPM_NAME_PATTERN.test(name)) {
		throw new Error(`npm 包名不合法：${name}`);
	}
}

function resolveNpmVersion(
	metadata: NpmPackageMetadata,
	name: string,
	wanted: string,
): string {
	const versions = metadata.versions ?? {};
	let version: string | null | undefined;
	if (wanted.length === 0 || wanted === "latest") {
		version = metadata["dist-tags"]?.latest;
	} else if (Object.hasOwn(versions, wanted)) {
		version = wanted;
	} else {
		version = maxSatisfying(Object.keys(versions), wanted);
	}
	if (version === undefined || version === null) {
		throw new Error(
			`npm 包 ${name} 没有匹配 ${wanted.length === 0 ? "latest" : wanted} 的版本`,
		);
	}
	if (!Object.hasOwn(versions, version)) {
		throw new Error(`npm 包 ${name} 的元数据缺少版本 ${version}`);
	}
	return version;
}

function verifyNpmIntegrity(
	integrity: string | undefined,
	bytes: Uint8Array,
	label: string,
): void {
	if (integrity === undefined || integrity.trim().length === 0) return;
	const token = integrity.trim().split(/\s+/)[0];
	const dash = token.indexOf("-");
	if (dash <= 0) {
		throw new Error(`${label} 的完整性字段不合法：${integrity}`);
	}
	const algorithm = token.slice(0, dash).toLowerCase();
	const expected = token.slice(dash + 1);
	let actual: string;
	try {
		actual = createHash(algorithm).update(bytes).digest("base64");
	} catch {
		throw new Error(`${label} 的完整性算法不受支持：${algorithm}`);
	}
	if (actual !== expected) {
		throw new Error(`${label} 的下载内容与完整性字段不一致`);
	}
}

/** npm tarball 的顶层目录是 `package/`；只解包普通文件与目录。 */
async function extractNpmTarball(
	tarballPath: string,
	targetDir: string,
): Promise<void> {
	await extractTar({
		cwd: targetDir,
		file: tarballPath,
		strip: 1,
		preservePaths: false,
		strict: true,
		filter: (path, entry) => {
			if (
				!("type" in entry) ||
				(entry.type !== "File" && entry.type !== "Directory")
			) {
				return false;
			}
			const target = resolve(targetDir, path);
			return target === targetDir || target.startsWith(targetDir + sep);
		},
	});
}

function readZipEntryPath(root: string, name: string): string {
	assertCodePluginRelativePath(name, "zip 条目");
	const target = resolve(root, name);
	if (target === root || !target.startsWith(root + sep)) {
		throw new Error(`zip 条目逃出了安装目录：${name}`);
	}
	return target;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
