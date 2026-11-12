import type { JsonObject } from "../json.js";
import {
	assertJsonValue,
	assertPlainObject,
	rejectUnknownKeys,
} from "../json.js";
import { isLedgerNamespace } from "../ledger/schema.js";
import type { LedgerNamespace } from "../ledger/schema.js";
import { LLM_MODEL_ROLE_NAMES } from "../llm/channels.js";
import type { LlmModelRole } from "../llm/channels.js";
import { readPluginName, readPluginVersion } from "./declarative.js";
import {
	assertInstalledVersion,
	readVersionRange,
	versionSatisfies,
} from "./versions.js";

/** 代码插件的格式标识；与声明式插件的 `dramaticer.plugin` 互不兼容。 */
export const CODE_PLUGIN_FORMAT = "dramaticer.code-plugin";

/** 代码插件清单的格式版本；字段变化时整体升版，旧版本直接拒绝。 */
export const CODE_PLUGIN_FORMAT_VERSION = 1;

/** 代码插件在清单里的档位；声明式插件没有这一项。 */
export const CODE_PLUGIN_TIER = "code";

export const CODE_PLUGIN_PERMISSION_KINDS = [
	"network",
	"files",
	"model",
	"ledger-write",
] as const;

export type CodePluginPermissionKind =
	(typeof CODE_PLUGIN_PERMISSION_KINDS)[number];

/** 允许访问的主机；支持 `*.example.com` 形式的前缀通配与端口。 */
export interface CodePluginNetworkPermission {
	readonly kind: "network";
	readonly hosts: readonly string[];
}

/** 插件目录内的相对路径；`read` 只读，`read-write` 可写。 */
export interface CodePluginFilesPermission {
	readonly kind: "files";
	readonly access: "read" | "read-write";
	readonly paths: readonly string[];
}

/** 允许调用的模型角色；调用仍走内核的渠道与故障转移。 */
export interface CodePluginModelPermission {
	readonly kind: "model";
	readonly roles: readonly LlmModelRole[];
}

/** 允许提交的台账命名空间；写入仍然经过结算器校验（I12）。 */
export interface CodePluginLedgerWritePermission {
	readonly kind: "ledger-write";
	readonly namespaces: readonly LedgerNamespace[];
}

export type CodePluginPermission =
	| CodePluginNetworkPermission
	| CodePluginFilesPermission
	| CodePluginModelPermission
	| CodePluginLedgerWritePermission;

export interface CodePluginManifest {
	readonly format: typeof CODE_PLUGIN_FORMAT;
	readonly formatVersion: typeof CODE_PLUGIN_FORMAT_VERSION;
	readonly name: string;
	readonly version: string;
	readonly tier: typeof CODE_PLUGIN_TIER;
	/** 兼容的 Dramaticer 版本范围，语法与玩法包依赖相同。 */
	readonly engine: string;
	/** 相对插件目录的入口模块，必须是 `.js` 或 `.mjs`。 */
	readonly entry: string;
	readonly title?: string;
	readonly description?: string;
	readonly inject: readonly string[];
	readonly provide: readonly string[];
	/** 配置的 JSON Schema；没有时表示接受任意 JSON 配置。 */
	readonly configSchema?: JsonObject;
	readonly permissions: readonly CodePluginPermission[];
}

/** 安装界面展示的一条权限。 */
export interface CodePluginPermissionDisplay {
	readonly kind: CodePluginPermissionKind;
	readonly summary: string;
}

export interface CodePluginPermissionChange {
	readonly permission: CodePluginPermission;
	readonly summary: string;
}

/** 升级时权限的差异；任一侧非空都表示需要用户重新确认。 */
export interface CodePluginPermissionChanges {
	readonly added: readonly CodePluginPermissionChange[];
	readonly removed: readonly CodePluginPermissionChange[];
	readonly requiresConfirmation: boolean;
}

const MANIFEST_KEYS = [
	"format",
	"formatVersion",
	"name",
	"version",
	"tier",
	"engine",
	"entry",
	"title",
	"description",
	"inject",
	"provide",
	"configSchema",
	"permissions",
];

const SERVICE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const HOST_PATTERN =
	/^(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/;
const DRIVE_PREFIX = /^[A-Za-z]:/;

/**
 * 解析一个代码插件清单。输入先按 JSON 值校验，函数与类实例无法通过；
 * 未知字段一律拒绝，权限范围必须能直接用于运行时判定。
 */
export function parseCodePluginManifest(
	value: unknown,
	path = "codePlugin",
): CodePluginManifest {
	assertJsonValue(value, path);
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, MANIFEST_KEYS, path);
	if (object.format !== CODE_PLUGIN_FORMAT) {
		throw new Error(`${path}.format 必须是 ${CODE_PLUGIN_FORMAT}`);
	}
	if (object.formatVersion !== CODE_PLUGIN_FORMAT_VERSION) {
		throw new Error(
			`${path}.formatVersion 只支持 ${CODE_PLUGIN_FORMAT_VERSION}`,
		);
	}
	const name = readPluginName(object.name, `${path}.name`);
	const version = readPluginVersion(object.version, `${path}.version`);
	if (object.tier !== CODE_PLUGIN_TIER) {
		throw new Error(`${path}.tier 必须是 ${CODE_PLUGIN_TIER}`);
	}
	const engine = readVersionRange(object.engine, `${path}.engine`);
	const entry = readEntryPath(object.entry, `${path}.entry`);
	const title =
		object.title === undefined
			? undefined
			: readText(object.title, `${path}.title`);
	const description =
		object.description === undefined
			? undefined
			: readText(object.description, `${path}.description`);
	const inject = readServiceNames(object.inject, `${path}.inject`);
	const provide = readServiceNames(object.provide, `${path}.provide`);
	const overlap = inject.find((service) => provide.includes(service));
	if (overlap !== undefined) {
		throw new Error(`${path} 的 inject 与 provide 不能同时包含 ${overlap}`);
	}
	const configSchema =
		object.configSchema === undefined
			? undefined
			: (assertPlainObject(
					object.configSchema,
					`${path}.configSchema`,
				) as JsonObject);
	return {
		format: CODE_PLUGIN_FORMAT,
		formatVersion: CODE_PLUGIN_FORMAT_VERSION,
		name,
		version,
		tier: CODE_PLUGIN_TIER,
		engine,
		entry,
		...(title === undefined ? {} : { title }),
		...(description === undefined ? {} : { description }),
		inject,
		provide,
		...(configSchema === undefined ? {} : { configSchema }),
		permissions: readPermissions(object.permissions, `${path}.permissions`),
	};
}

/** 解析一组清单；名字重复时整组拒绝，避免后加载的静默覆盖前一个。 */
export function parseCodePluginManifests(
	value: unknown,
	path = "codePlugins",
): CodePluginManifest[] {
	if (!Array.isArray(value)) {
		throw new Error(`${path} 必须是数组`);
	}
	const names = new Set<string>();
	return value.map((item, index) => {
		const itemPath = `${path}[${index}]`;
		const manifest = parseCodePluginManifest(item, itemPath);
		if (names.has(manifest.name)) {
			throw new Error(`${itemPath}.name 重复：${manifest.name}`);
		}
		names.add(manifest.name);
		return manifest;
	});
}

/** 安装时逐条展示的权限文案，顺序与清单一致。 */
export function describeCodePluginPermissions(
	permissions: readonly CodePluginPermission[],
): CodePluginPermissionDisplay[] {
	return permissions.map((permission) => ({
		kind: permission.kind,
		summary: describePermission(permission),
	}));
}

/**
 * 比较已安装版本与新版本声明的权限。权限范围本身变化时，
 * 旧范围记入移除、新范围记入新增，用户会看到完整的差异。
 */
export function diffCodePluginPermissions(
	previous: readonly CodePluginPermission[],
	next: readonly CodePluginPermission[],
): CodePluginPermissionChanges {
	const previousKeys = new Set(previous.map(permissionKey));
	const nextKeys = new Set(next.map(permissionKey));
	const added = next
		.filter((permission) => !previousKeys.has(permissionKey(permission)))
		.map(toChange);
	const removed = previous
		.filter((permission) => !nextKeys.has(permissionKey(permission)))
		.map(toChange);
	return {
		added,
		removed,
		requiresConfirmation: added.length > 0 || removed.length > 0,
	};
}

/** 判断清单声明的兼容范围是否包含给定的本机版本。 */
export function isEngineCompatible(
	engineRange: string,
	engineVersion: string,
): boolean {
	const range = readVersionRange(engineRange, "engineRange");
	assertInstalledVersion(engineVersion, "engineVersion");
	return versionSatisfies(engineVersion, range);
}

function describePermission(permission: CodePluginPermission): string {
	switch (permission.kind) {
		case "network":
			return `网络访问：${permission.hosts.join("、")}`;
		case "files":
			return `${permission.access === "read" ? "读取" : "读写"}文件：${permission.paths.join("、")}`;
		case "model":
			return `调用模型：${permission.roles.join("、")}`;
		case "ledger-write":
			return `写入台账：${permission.namespaces.join("、")}`;
	}
}

function toChange(
	permission: CodePluginPermission,
): CodePluginPermissionChange {
	return { permission, summary: describePermission(permission) };
}

function permissionKey(permission: CodePluginPermission): string {
	switch (permission.kind) {
		case "network":
			return `network:${[...permission.hosts].sort().join(",")}`;
		case "files":
			return `files:${permission.access}:${[...permission.paths].sort().join(",")}`;
		case "model":
			return `model:${[...permission.roles].sort().join(",")}`;
		case "ledger-write":
			return `ledger-write:${[...permission.namespaces].sort().join(",")}`;
	}
}

function readPermissions(value: unknown, path: string): CodePluginPermission[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error(`${path} 必须是数组`);
	}
	const kinds = new Set<string>();
	return value.map((item, index) => {
		const itemPath = `${path}[${index}]`;
		const permission = readPermission(item, itemPath);
		if (kinds.has(permission.kind)) {
			throw new Error(`${itemPath}.kind 重复：${permission.kind}`);
		}
		kinds.add(permission.kind);
		return permission;
	});
}

function readPermission(value: unknown, path: string): CodePluginPermission {
	const object = assertPlainObject(value, path);
	const kind = object.kind;
	if (
		typeof kind !== "string" ||
		!(CODE_PLUGIN_PERMISSION_KINDS as readonly string[]).includes(kind)
	) {
		throw new Error(
			`${path}.kind 必须是 ${CODE_PLUGIN_PERMISSION_KINDS.join("、")} 之一`,
		);
	}
	switch (kind as CodePluginPermissionKind) {
		case "network": {
			rejectUnknownKeys(object, ["kind", "hosts"], path);
			return {
				kind: "network",
				hosts: readStringList(object.hosts, `${path}.hosts`, readHost),
			};
		}
		case "files": {
			rejectUnknownKeys(object, ["kind", "access", "paths"], path);
			if (object.access !== "read" && object.access !== "read-write") {
				throw new Error(`${path}.access 必须是 read 或 read-write`);
			}
			return {
				kind: "files",
				access: object.access,
				paths: readStringList(object.paths, `${path}.paths`, readPluginPath),
			};
		}
		case "model": {
			rejectUnknownKeys(object, ["kind", "roles"], path);
			return {
				kind: "model",
				roles: readStringList(object.roles, `${path}.roles`, readModelRole),
			};
		}
		case "ledger-write": {
			rejectUnknownKeys(object, ["kind", "namespaces"], path);
			return {
				kind: "ledger-write",
				namespaces: readStringList(
					object.namespaces,
					`${path}.namespaces`,
					readLedgerNamespace,
				),
			};
		}
	}
}

function readStringList<T extends string>(
	value: unknown,
	path: string,
	readItem: (item: unknown, path: string) => T,
): T[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${path} 必须是非空数组`);
	}
	const seen = new Set<string>();
	return value.map((item, index) => {
		const read = readItem(item, `${path}[${index}]`);
		if (seen.has(read)) {
			throw new Error(`${path}[${index}] 重复：${read}`);
		}
		seen.add(read);
		return read;
	});
}

function readHost(value: unknown, path: string): string {
	const host = readText(value, path);
	if (!HOST_PATTERN.test(host)) {
		throw new Error(
			`${path} 必须是主机名、主机名加端口或 *.example.com 形式：${host}`,
		);
	}
	return host;
}

function readPluginPath(value: unknown, path: string): string {
	const pluginPath = readText(value, path);
	assertRelativePath(pluginPath, path);
	return pluginPath;
}

function readEntryPath(value: unknown, path: string): string {
	const entry = readText(value, path);
	assertRelativePath(entry, path);
	if (!/\.(?:js|mjs)$/.test(entry)) {
		throw new Error(`${path} 必须指向 .js 或 .mjs 文件：${entry}`);
	}
	return entry;
}

/** 插件目录内的路径只能向前走，不接受绝对路径与 `..` 段。 */
function assertRelativePath(value: string, path: string): void {
	if (value.includes("\\")) {
		throw new Error(`${path} 必须用 '/' 分隔路径：${value}`);
	}
	if (value.startsWith("/") || DRIVE_PREFIX.test(value)) {
		throw new Error(`${path} 必须是相对路径：${value}`);
	}
	if (value === ".") return;
	const segments = value.split("/");
	for (const segment of segments) {
		if (segment === "" || segment === "." || segment === "..") {
			throw new Error(`${path} 不能包含空段、'.' 或 '..'：${value}`);
		}
	}
}

function readModelRole(value: unknown, path: string): LlmModelRole {
	const role = readText(value, path);
	if (!(LLM_MODEL_ROLE_NAMES as readonly string[]).includes(role)) {
		throw new Error(
			`${path} 必须是 ${LLM_MODEL_ROLE_NAMES.join("、")} 之一：${role}`,
		);
	}
	return role as LlmModelRole;
}

function readLedgerNamespace(value: unknown, path: string): LedgerNamespace {
	const namespace = readText(value, path);
	if (!isLedgerNamespace(namespace)) {
		throw new Error(`${path} 不是已知台账命名空间：${namespace}`);
	}
	return namespace;
}

function readServiceNames(value: unknown, path: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error(`${path} 必须是数组`);
	}
	const seen = new Set<string>();
	return value.map((item, index) => {
		const name = readText(item, `${path}[${index}]`);
		if (!SERVICE_NAME_PATTERN.test(name)) {
			throw new Error(
				`${path}[${index}] 只能包含小写字母、数字、点、下划线与连字符：${name}`,
			);
		}
		if (seen.has(name)) {
			throw new Error(`${path}[${index}] 重复：${name}`);
		}
		seen.add(name);
		return name;
	});
}

function readText(value: unknown, path: string): string {
	if (typeof value !== "string") {
		throw new Error(`${path} 必须是字符串`);
	}
	if (value.trim().length === 0) {
		throw new Error(`${path} 不能是空字符串`);
	}
	if (value.trim() !== value) {
		throw new Error(`${path} 不能以空白开头或结尾`);
	}
	return value;
}
