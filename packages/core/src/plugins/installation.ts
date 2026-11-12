import {
	type CodePluginManifest,
	type CodePluginPermission,
	type CodePluginPermissionChange,
	codePluginPermissionKey,
	diffCodePluginPermissions,
	parseCodePluginManifest,
} from "./code-plugins.js";

/** 代码插件的三种安装来源；P4.d 的安装命令复用同一套校验。 */
export const CODE_PLUGIN_INSTALL_SOURCE_KINDS = ["npm", "git", "zip"] as const;

export type CodePluginInstallSourceKind =
	(typeof CODE_PLUGIN_INSTALL_SOURCE_KINDS)[number];

/** 来源类型加上可展示的来源说明：包名与版本、仓库地址或文件路径。 */
export interface CodePluginInstallSource {
	readonly kind: CodePluginInstallSourceKind;
	readonly spec: string;
}

/** 一个代码插件的安装记录；安装与升级都覆盖同一行。 */
export interface CodePluginInstallationRecord {
	readonly name: string;
	readonly version: string;
	readonly manifest: CodePluginManifest;
	/** 用户确认过的权限；写入记录时等于清单声明的权限。 */
	readonly grantedPermissions: readonly CodePluginPermission[];
	readonly source: CodePluginInstallSource;
	readonly installedAt: string;
}

/** 安装记录的最小存储接口；`StoryStore` 直接满足这个形状。 */
export interface CodePluginInstallationStore {
	getCodePluginInstallation(name: string): CodePluginInstallationRecord | null;
	saveCodePluginInstallation(
		record: CodePluginInstallationRecord,
	): CodePluginInstallationRecord;
	listCodePluginInstallations(): CodePluginInstallationRecord[];
	/** 删除安装记录；记录不存在时返回 false。 */
	deleteCodePluginInstallation(name: string): boolean;
}

/** 待确认的安装计划：安装界面按 `added` 与 `removed` 逐条展示。 */
export interface CodePluginInstallPlan {
	readonly manifest: CodePluginManifest;
	readonly source: CodePluginInstallSource;
	/** 已安装的版本；首次安装为 null。 */
	readonly previousVersion: string | null;
	/** 首次安装是全部权限，升级只含新增权限。 */
	readonly added: readonly CodePluginPermissionChange[];
	readonly removed: readonly CodePluginPermissionChange[];
	readonly requiresConfirmation: boolean;
}

export interface ConfirmCodePluginInstallationOptions {
	readonly installedAt?: string;
}

export function assertCodePluginInstallSource(
	value: unknown,
	path = "source",
): CodePluginInstallSource {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} 必须是对象`);
	}
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (key !== "kind" && key !== "spec") {
			throw new Error(`${path}.${key} 是未知字段`);
		}
	}
	const kind = record.kind;
	if (
		typeof kind !== "string" ||
		!(CODE_PLUGIN_INSTALL_SOURCE_KINDS as readonly string[]).includes(kind)
	) {
		throw new Error(
			`${path}.kind 必须是 ${CODE_PLUGIN_INSTALL_SOURCE_KINDS.join("、")} 之一`,
		);
	}
	const spec = record.spec;
	if (typeof spec !== "string" || spec.trim().length === 0) {
		throw new Error(`${path}.spec 必须是非空字符串`);
	}
	if (spec.trim() !== spec) {
		throw new Error(`${path}.spec 不能以空白开头或结尾`);
	}
	return { kind: kind as CodePluginInstallSourceKind, spec };
}

/**
 * 计算安装或升级需要用户确认的权限。首次安装列出全部权限并要求确认；
 * 升级只列出与已授予权限之间的差异，权限没有变化时不要求确认。
 */
export function planCodePluginInstallation(
	store: CodePluginInstallationStore,
	manifest: CodePluginManifest,
	source: CodePluginInstallSource,
): CodePluginInstallPlan {
	const parsedManifest = parseCodePluginManifest(manifest, "codePlugin");
	const installSource = assertCodePluginInstallSource(
		source,
		"codePluginSource",
	);
	const previous = store.getCodePluginInstallation(parsedManifest.name);
	if (previous === null) {
		const all = diffCodePluginPermissions([], parsedManifest.permissions);
		return {
			manifest: parsedManifest,
			source: installSource,
			previousVersion: null,
			added: all.added,
			removed: [],
			requiresConfirmation: true,
		};
	}
	const changes = diffCodePluginPermissions(
		previous.grantedPermissions,
		parsedManifest.permissions,
	);
	return {
		manifest: parsedManifest,
		source: installSource,
		previousVersion: previous.version,
		added: changes.added,
		removed: changes.removed,
		requiresConfirmation: changes.requiresConfirmation,
	};
}

/**
 * 用户在看过计划之后确认安装。调用方必须已经取得确认；计划与当前记录
 * 对不上时拒绝写入，避免确认过的权限与实际授予的权限不一致。
 */
export function confirmCodePluginInstallation(
	store: CodePluginInstallationStore,
	plan: CodePluginInstallPlan,
	options: ConfirmCodePluginInstallationOptions = {},
): CodePluginInstallationRecord {
	const current = planCodePluginInstallation(store, plan.manifest, plan.source);
	if (
		current.previousVersion !== plan.previousVersion ||
		!sameChanges(current.added, plan.added) ||
		!sameChanges(current.removed, plan.removed)
	) {
		throw new Error(`安装计划已过期：${plan.manifest.name}`);
	}
	const installedAt = options.installedAt ?? new Date().toISOString();
	if (
		typeof installedAt !== "string" ||
		installedAt.trim().length === 0 ||
		installedAt.trim() !== installedAt
	) {
		throw new Error("安装时间必须是不带首尾空白的非空字符串");
	}
	return store.saveCodePluginInstallation({
		name: current.manifest.name,
		version: current.manifest.version,
		manifest: current.manifest,
		grantedPermissions: current.manifest.permissions,
		source: current.source,
		installedAt,
	});
}

/**
 * 启动时核对安装记录与磁盘上的清单。缺记录、多记录、清单内容或
 * 已授予权限不一致都直接失败，并指出插件名。
 */
export function assertInstalledCodePluginsMatch(
	store: CodePluginInstallationStore,
	manifests: readonly CodePluginManifest[],
): void {
	const onDisk = new Map<string, CodePluginManifest>();
	for (const [index, manifest] of manifests.entries()) {
		const parsed = parseCodePluginManifest(
			manifest,
			`installedPlugins[${index}]`,
		);
		onDisk.set(parsed.name, parsed);
	}
	const records = store.listCodePluginInstallations();
	const recorded = new Set<string>();
	for (const record of records) {
		recorded.add(record.name);
		const stored = parseCodePluginManifest(
			record.manifest,
			`插件 ${record.name} 的安装记录`,
		);
		const disk = onDisk.get(stored.name);
		if (disk === undefined) {
			throw new Error(`插件的安装记录没有对应的磁盘清单：${stored.name}`);
		}
		if (manifestFingerprint(disk) !== manifestFingerprint(stored)) {
			throw new Error(`插件的安装记录与磁盘清单不一致：${stored.name}`);
		}
		if (!samePermissionKeys(record.grantedPermissions, stored.permissions)) {
			throw new Error(`插件的安装记录与磁盘清单的权限不一致：${stored.name}`);
		}
	}
	for (const name of onDisk.keys()) {
		if (!recorded.has(name)) {
			throw new Error(`插件缺少安装记录：${name}`);
		}
	}
}

function sameChanges(
	left: readonly CodePluginPermissionChange[],
	right: readonly CodePluginPermissionChange[],
): boolean {
	const leftKeys = left.map((change) =>
		codePluginPermissionKey(change.permission),
	);
	const rightKeys = right.map((change) =>
		codePluginPermissionKey(change.permission),
	);
	return samePermissionKeys(leftKeys, rightKeys);
}

function samePermissionKeys(
	left: readonly (CodePluginPermission | string)[],
	right: readonly (CodePluginPermission | string)[],
): boolean {
	const leftKeys = left
		.map((item) =>
			typeof item === "string" ? item : codePluginPermissionKey(item),
		)
		.sort();
	const rightKeys = right
		.map((item) =>
			typeof item === "string" ? item : codePluginPermissionKey(item),
		)
		.sort();
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every((key, index) => key === rightKeys[index])
	);
}

function manifestFingerprint(manifest: CodePluginManifest): string {
	return JSON.stringify({
		format: manifest.format,
		formatVersion: manifest.formatVersion,
		name: manifest.name,
		version: manifest.version,
		tier: manifest.tier,
		engine: manifest.engine,
		entry: manifest.entry,
		title: manifest.title ?? null,
		description: manifest.description ?? null,
		inject: [...manifest.inject].sort(),
		provide: [...manifest.provide].sort(),
		configSchema: manifest.configSchema ?? null,
		permissions: manifest.permissions.map(codePluginPermissionKey).sort(),
	});
}
