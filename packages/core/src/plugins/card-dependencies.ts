import type { DeclarativeRequirements } from "./declarative.js";
import { assertInstalledVersion, versionSatisfies } from "./versions.js";

export type CardDependencyKind = "plugin" | "playpack";
export type CardDependencyLevel = "required" | "recommended";
export type CardDependencyStatus =
	| "missing"
	| "version-mismatch"
	| "unknown-version";

/** 本机可用的一项插件或玩法包；版本未知时只按名称匹配。 */
export interface InstalledCardDependency {
	readonly name: string;
	readonly version?: string;
}

/** 导入卡片时用来核对依赖的本机清单。 */
export interface CardDependencyCatalog {
	readonly plugins: readonly InstalledCardDependency[];
	readonly playpacks: readonly InstalledCardDependency[];
}

/** 一条未满足的依赖；`message` 是可以直接展示给用户的安装建议。 */
export interface CardDependencyIssue {
	readonly kind: CardDependencyKind;
	readonly level: CardDependencyLevel;
	readonly name: string;
	readonly versionRange: string | null;
	readonly installedVersion: string | null;
	readonly status: CardDependencyStatus;
	readonly message: string;
}

export interface CardDependencyReport {
	/** 必需依赖是否全部满足；推荐依赖不影响这个值。 */
	readonly satisfied: boolean;
	readonly issues: readonly CardDependencyIssue[];
}

export interface CardDependencyInput {
	readonly requires: DeclarativeRequirements;
	readonly recommends: DeclarativeRequirements;
}

const EMPTY_CATALOG: CardDependencyCatalog = { plugins: [], playpacks: [] };

const KIND_LABEL: Record<CardDependencyKind, string> = {
	plugin: "插件",
	playpack: "玩法包",
};

/**
 * 把卡片声明的必需与推荐依赖和本机清单逐条比较。只返回未满足的条目；
 * 版本范围按 semver 匹配，已安装版本未知时记为无法确认，不当作满足。
 */
export function checkCardDependencies(
	input: CardDependencyInput,
	catalog: CardDependencyCatalog = EMPTY_CATALOG,
): CardDependencyReport {
	const available: Record<CardDependencyKind, Map<string, string | null>> = {
		plugin: indexCatalog(catalog.plugins, "可用插件"),
		playpack: indexCatalog(catalog.playpacks, "可用玩法包"),
	};
	const issues: CardDependencyIssue[] = [];
	for (const level of ["required", "recommended"] as const) {
		const requirements =
			level === "required" ? input.requires : input.recommends;
		for (const dependency of requirements.plugins) {
			const issue = checkDependency(
				"plugin",
				level,
				dependency.name,
				dependency.versionRange ?? null,
				available.plugin,
			);
			if (issue !== null) issues.push(issue);
		}
		for (const dependency of requirements.playpacks) {
			const issue = checkDependency(
				"playpack",
				level,
				dependency.name,
				dependency.versionRange ?? null,
				available.playpack,
			);
			if (issue !== null) issues.push(issue);
		}
	}
	return {
		satisfied: !issues.some((issue) => issue.level === "required"),
		issues,
	};
}

function checkDependency(
	kind: CardDependencyKind,
	level: CardDependencyLevel,
	name: string,
	versionRange: string | null,
	available: ReadonlyMap<string, string | null>,
): CardDependencyIssue | null {
	const label = KIND_LABEL[kind];
	const installed = available.get(name);
	if (installed === undefined) {
		return {
			kind,
			level,
			name,
			versionRange,
			installedVersion: null,
			status: "missing",
			message:
				level === "required"
					? `缺少必需${label} ${name}${formatRange(versionRange)}，请先安装 ${name}`
					: `推荐安装${label} ${name}${formatRange(versionRange)}`,
		};
	}
	if (versionRange === null) return null;
	if (installed === null) {
		return {
			kind,
			level,
			name,
			versionRange,
			installedVersion: null,
			status: "unknown-version",
			message: `已安装${label} ${name}，但版本未知，无法确认是否满足 ${versionRange}，请确认已安装版本`,
		};
	}
	if (versionSatisfies(installed, versionRange)) return null;
	return {
		kind,
		level,
		name,
		versionRange,
		installedVersion: installed,
		status: "version-mismatch",
		message: `${label} ${name} 已安装 ${installed}，不满足 ${versionRange}，请升级 ${name}`,
	};
}

function indexCatalog(
	entries: readonly InstalledCardDependency[],
	path: string,
): Map<string, string | null> {
	const index = new Map<string, string | null>();
	for (const entry of entries) {
		if (index.has(entry.name)) {
			throw new Error(`${path}里的名称重复：${entry.name}`);
		}
		if (entry.version !== undefined) {
			assertInstalledVersion(entry.version, `${path} ${entry.name} 的版本`);
		}
		index.set(entry.name, entry.version ?? null);
	}
	return index;
}

function formatRange(versionRange: string | null): string {
	return versionRange === null ? "" : `（版本 ${versionRange}）`;
}
