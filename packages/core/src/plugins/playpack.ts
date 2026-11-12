import {
	type JsonObject,
	assertJsonValue,
	assertPlainObject,
	isJsonObject,
	rejectUnknownKeys,
} from "../json.js";
import {
	type DeclarativePlugin,
	type DeclarativeRequirements,
	parseDeclarativePlugins,
	parseDeclarativeRequirements,
	readPluginName,
	readPluginVersion,
} from "./declarative.js";
import {
	EMPTY_PLAYPACK_USER_OVERRIDES,
	type PlaypackUserOverrides,
	clonePlaypackJson,
	clonePlaypackJsonObject,
	parsePlaypackConfigPatches,
	parsePlaypackSwitches,
} from "./playpack-overrides.js";

/** 玩法包的格式标识；玩法包文件与用户覆盖都按同一套外壳解析。 */
export const PLAYPACK_FORMAT = "dramaticer.playpack";

/** 当前唯一支持的格式版本；类型扩展时整体升版，不猜测兼容性。 */
export const PLAYPACK_FORMAT_VERSION = 1;

/**
 * 玩法包清单：一组声明式插件，加上对插件配置与开关的补丁。
 * `config` 与 `switches` 都以插件名称为键，未出现的插件保持前一层的状态。
 */
export interface PlaypackManifest {
	readonly format: typeof PLAYPACK_FORMAT;
	readonly formatVersion: typeof PLAYPACK_FORMAT_VERSION;
	readonly name: string;
	readonly version: string;
	readonly title?: string;
	readonly description?: string;
	/** 需要更早加载的玩法包与插件；版本范围的匹配留给导入流程。 */
	readonly requirements: DeclarativeRequirements;
	readonly plugins: readonly DeclarativePlugin[];
	readonly config: Readonly<Record<string, JsonObject>>;
	readonly switches: Readonly<Record<string, boolean>>;
}

/** 一层叠加完成后可直接交给运行时的结果。 */
export interface ResolvedPlaypack {
	/** 按加载顺序记录参与叠加的玩法包。 */
	readonly playpacks: readonly {
		readonly name: string;
		readonly version: string;
	}[];
	readonly plugins: readonly DeclarativePlugin[];
	/** 深合并后的插件配置补丁，键为插件名称。 */
	readonly configs: Readonly<Record<string, JsonObject>>;
	/** 显式声明过的插件开关；未出现的插件按启用处理。 */
	readonly switches: Readonly<Record<string, boolean>>;
}

export interface PlaypackStackOptions {
	readonly overrides?: PlaypackUserOverrides;
	/** 本机已有的插件名称（内置模块与已安装插件）；用于识别配置里的拼写错误。 */
	readonly knownPluginNames?: readonly string[];
}

const MANIFEST_KEYS = [
	"format",
	"formatVersion",
	"name",
	"version",
	"title",
	"description",
	"requirements",
	"plugins",
	"config",
	"switches",
];
/** 解析一个玩法包文件；输入先按 JSON 值校验，代码无法通过。 */
export function parsePlaypackManifest(
	value: unknown,
	path = "playpack",
): PlaypackManifest {
	assertJsonValue(value, path);
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, MANIFEST_KEYS, path);
	if (object.format !== PLAYPACK_FORMAT) {
		throw new Error(`${path}.format 必须是 ${PLAYPACK_FORMAT}`);
	}
	if (object.formatVersion !== PLAYPACK_FORMAT_VERSION) {
		throw new Error(`${path}.formatVersion 只支持 ${PLAYPACK_FORMAT_VERSION}`);
	}
	const name = readPluginName(object.name, `${path}.name`);
	const version = readPluginVersion(object.version, `${path}.version`);
	const title =
		object.title === undefined
			? undefined
			: readNonEmptyString(object.title, `${path}.title`);
	const description =
		object.description === undefined
			? undefined
			: readNonEmptyString(object.description, `${path}.description`);
	const requirements = parseDeclarativeRequirements(
		object.requirements,
		`${path}.requirements`,
	);
	const plugins = parseDeclarativePlugins(object.plugins, `${path}.plugins`);
	const config = parsePlaypackConfigPatches(object.config, `${path}.config`);
	const switches = parsePlaypackSwitches(object.switches, `${path}.switches`);
	return {
		format: PLAYPACK_FORMAT,
		formatVersion: PLAYPACK_FORMAT_VERSION,
		name,
		version,
		...(title === undefined ? {} : { title }),
		...(description === undefined ? {} : { description }),
		requirements,
		plugins,
		config,
		switches,
	};
}

/** 解析一组玩法包；同名玩法包整组拒绝，避免叠加时出现两份清单。 */
export function parsePlaypacks(
	value: unknown,
	path = "playpacks",
): PlaypackManifest[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error(`${path} 必须是数组`);
	}
	const names = new Set<string>();
	return value.map((item, index) => {
		const itemPath = `${path}[${index}]`;
		const playpack = parsePlaypackManifest(item, itemPath);
		if (names.has(playpack.name)) {
			throw new Error(`${itemPath}.name 重复：${playpack.name}`);
		}
		names.add(playpack.name);
		return playpack;
	});
}

/**
 * 按加载顺序叠加玩法包，再把用户覆盖放在最上层。
 * 后加载的包覆盖前面同名插件的配置（嵌套对象逐层合并，数组与标量整体替换）
 * 与开关；输入文件只读，返回的结构全部是新对象。
 */
export function stackPlaypacks(
	packs: readonly PlaypackManifest[],
	options: PlaypackStackOptions = {},
): ResolvedPlaypack {
	const known = new Set(options.knownPluginNames ?? []);
	const declared = new Set<string>();
	for (const pack of packs) {
		for (const plugin of pack.plugins) {
			if (declared.has(plugin.name)) {
				throw new Error(
					`玩法包 ${pack.name} 定义的插件 ${plugin.name} 已被更早的玩法包定义`,
				);
			}
			declared.add(plugin.name);
		}
	}
	const available = new Set([...declared, ...known]);

	const loaded = new Map<string, string>();
	const plugins: DeclarativePlugin[] = [];
	const configs: Record<string, JsonObject> = {};
	const switches: Record<string, boolean> = {};

	for (const pack of packs) {
		if (loaded.has(pack.name)) {
			throw new Error(`玩法包 ${pack.name} 在叠加里出现了两次`);
		}
		assertRequirements(pack, loaded, loadedPluginNames(plugins, pack));
		for (const plugin of pack.plugins) plugins.push(plugin);
		for (const [pluginName, patch] of Object.entries(pack.config)) {
			assertKnown(pluginName, available, `玩法包 ${pack.name} 的配置`);
			const current = configs[pluginName];
			configs[pluginName] = Object.hasOwn(configs, pluginName)
				? mergePatch(current as JsonObject, patch)
				: clonePlaypackJsonObject(patch);
		}
		for (const [pluginName, enabled] of Object.entries(pack.switches)) {
			assertKnown(pluginName, available, `玩法包 ${pack.name} 的开关`);
			switches[pluginName] = enabled;
		}
		loaded.set(pack.name, pack.version);
	}

	const overrides = options.overrides ?? EMPTY_PLAYPACK_USER_OVERRIDES;
	for (const [pluginName, patch] of Object.entries(overrides.config)) {
		assertKnown(pluginName, available, "用户覆盖的配置");
		const current = configs[pluginName];
		configs[pluginName] = Object.hasOwn(configs, pluginName)
			? mergePatch(current as JsonObject, patch)
			: clonePlaypackJsonObject(patch);
	}
	for (const [pluginName, enabled] of Object.entries(overrides.switches)) {
		assertKnown(pluginName, available, "用户覆盖的开关");
		switches[pluginName] = enabled;
	}

	return {
		playpacks: packs.map((pack) => ({
			name: pack.name,
			version: pack.version,
		})),
		plugins,
		configs,
		switches,
	};
}

/** 显式为 false 才算关闭；没有声明过的插件按启用处理。 */
export function isPlaypackPluginEnabled(
	resolved: ResolvedPlaypack,
	pluginName: string,
): boolean {
	return resolved.switches[pluginName] !== false;
}

/** 按故事解析后的结果：关闭的插件不出现在 `plugins` 与 `configs` 里。 */
export interface ResolvedStoryPlugins extends ResolvedPlaypack {
	readonly disabledPlugins: readonly string[];
}

/**
 * 解析一个故事最终启用的插件与配置：玩法包叠加之后应用故事级开关与覆盖，
 * 再剔除显式关闭的插件。故事覆盖来自 `StorySettings.pluginOverrides`，
 * 同一故事的所有分支读取同一份设置。
 */
export function resolveStoryPlugins(
	packs: readonly PlaypackManifest[],
	options: PlaypackStackOptions = {},
): ResolvedStoryPlugins {
	const resolved = stackPlaypacks(packs, options);
	const disabled = new Set<string>();
	for (const [pluginName, enabled] of Object.entries(resolved.switches)) {
		if (!enabled) disabled.add(pluginName);
	}
	const configs: Record<string, JsonObject> = {};
	for (const [pluginName, patch] of Object.entries(resolved.configs)) {
		if (disabled.has(pluginName)) continue;
		configs[pluginName] = patch;
	}
	return {
		playpacks: resolved.playpacks,
		plugins: resolved.plugins.filter((plugin) => !disabled.has(plugin.name)),
		configs,
		switches: resolved.switches,
		disabledPlugins: [...disabled],
	};
}

function assertRequirements(
	pack: PlaypackManifest,
	loaded: ReadonlyMap<string, string>,
	ownPluginNames: ReadonlySet<string>,
): void {
	for (const dependency of pack.requirements.playpacks) {
		if (!loaded.has(dependency.name)) {
			throw new Error(
				`玩法包 ${pack.name} 需要更早加载的玩法包 ${dependency.name}`,
			);
		}
	}
	for (const dependency of pack.requirements.plugins) {
		if (!ownPluginNames.has(dependency.name)) {
			throw new Error(
				`玩法包 ${pack.name} 需要更早加载的插件 ${dependency.name}`,
			);
		}
	}
}

function loadedPluginNames(
	plugins: readonly DeclarativePlugin[],
	pack: PlaypackManifest,
): ReadonlySet<string> {
	const names = new Set(plugins.map((plugin) => plugin.name));
	for (const plugin of pack.plugins) names.add(plugin.name);
	return names;
}

function assertKnown(
	pluginName: string,
	available: ReadonlySet<string>,
	what: string,
): void {
	if (!available.has(pluginName)) {
		throw new Error(`${what}引用了未知插件：${pluginName}`);
	}
}
function mergePatch(base: JsonObject, patch: JsonObject): JsonObject {
	const result: JsonObject = clonePlaypackJsonObject(base);
	for (const [key, value] of Object.entries(patch)) {
		const current = result[key];
		result[key] =
			current !== undefined && isJsonObject(current) && isJsonObject(value)
				? mergePatch(current, value)
				: clonePlaypackJson(value);
	}
	return result;
}

function readNonEmptyString(value: unknown, path: string): string {
	if (typeof value !== "string") {
		throw new Error(`${path} 必须是字符串`);
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new Error(`${path} 不能是空字符串`);
	}
	return trimmed;
}
