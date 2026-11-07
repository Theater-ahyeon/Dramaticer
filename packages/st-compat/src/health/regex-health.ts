import type { StPreset } from "../preset.js";
import type {
	BlockStrategy,
	DeleteScope,
	RegexCategory,
} from "../regex-classifier.js";
import { classifyRegexScript } from "../regex-classifier.js";

export interface RegexCategoryCount {
	readonly category: RegexCategory;
	readonly scriptCount: number;
	readonly enabledScriptCount: number;
	readonly upgradableScriptCount: number;
}

export interface RegexDeleteScopeCount {
	readonly scope: DeleteScope;
	readonly scriptCount: number;
}

export interface RegexStrategyCount {
	readonly strategy: BlockStrategy;
	readonly scriptCount: number;
}

export interface RegexTagCount {
	readonly tag: string;
	readonly scriptCount: number;
}

export interface RegexHealth {
	readonly scriptCount: number;
	readonly enabledScriptCount: number;
	readonly disabledScriptCount: number;
	/** 启用的脚本里可以自动升级成块策略的数量 */
	readonly upgradableScriptCount: number;
	readonly categories: readonly RegexCategoryCount[];
	readonly deleteScopes: readonly RegexDeleteScopeCount[];
	readonly strategies: readonly RegexStrategyCount[];
	readonly topTags: readonly RegexTagCount[];
	readonly depthScopedScriptCount: number;
	readonly inlineScriptCount: number;
	readonly streamingScriptCount: number;
}

export const REGEX_CATEGORY_LABELS: Readonly<Record<RegexCategory, string>> = {
	html_render: "渲染 HTML",
	html_script: "内联脚本",
	delete: "删除内容",
	strip_cot: "删除思考链",
	rewrite_capture: "重排捕获内容",
	text_replace: "文本替换",
	streaming_variant: "流式版本",
	unclassified: "无法分类",
};

const REGEX_CATEGORY_ORDER: readonly RegexCategory[] = [
	"html_render",
	"html_script",
	"delete",
	"strip_cot",
	"rewrite_capture",
	"text_replace",
	"streaming_variant",
	"unclassified",
];

export const DELETE_SCOPE_LABELS: Readonly<Record<DeleteScope, string>> = {
	display: "只影响显示",
	prompt: "只影响 prompt",
	both: "两者",
};

const DELETE_SCOPE_ORDER: readonly DeleteScope[] = [
	"display",
	"prompt",
	"both",
];

export const BLOCK_STRATEGY_LABELS: Readonly<Record<BlockStrategy, string>> = {
	block_policy: "块策略",
	renderer: "渲染器",
	sandbox_renderer: "沙箱渲染器",
	keep_regex: "保留原正则",
};

const BLOCK_STRATEGY_ORDER: readonly BlockStrategy[] = [
	"block_policy",
	"renderer",
	"sandbox_renderer",
	"keep_regex",
];

/** 对每个预设的正则单独分类；同预设的其他脚本参与流式版本合并判断。 */
export function analyzeRegexScripts(presets: readonly StPreset[]): RegexHealth {
	const categories = new Map<
		RegexCategory,
		{ total: number; enabled: number; upgradable: number }
	>();
	for (const category of REGEX_CATEGORY_ORDER) {
		categories.set(category, { total: 0, enabled: 0, upgradable: 0 });
	}
	const scopes = new Map<DeleteScope, number>();
	const strategies = new Map<BlockStrategy, number>();
	const tags = new Map<string, number>();
	let scriptCount = 0;
	let enabledScriptCount = 0;
	let upgradableScriptCount = 0;
	let depthScopedScriptCount = 0;
	let inlineScriptCount = 0;
	let streamingScriptCount = 0;

	for (const preset of presets) {
		const scripts = preset.regexScripts;
		for (const script of scripts) {
			const result = classifyRegexScript(script, scripts);
			scriptCount += 1;
			const bucket = categories.get(result.category);
			if (bucket) {
				bucket.total += 1;
				if (!script.disabled) bucket.enabled += 1;
				if (!script.disabled && result.upgrade.applicable) {
					bucket.upgradable += 1;
				}
			}
			if (!script.disabled) {
				enabledScriptCount += 1;
				if (result.upgrade.applicable) upgradableScriptCount += 1;
			}
			if (result.deleteScope !== null) {
				scopes.set(
					result.deleteScope,
					(scopes.get(result.deleteScope) ?? 0) + 1,
				);
			}
			strategies.set(
				result.upgrade.strategy,
				(strategies.get(result.upgrade.strategy) ?? 0) + 1,
			);
			if (result.tagName !== null) {
				tags.set(result.tagName, (tags.get(result.tagName) ?? 0) + 1);
			}
			if (result.depthScoped) depthScopedScriptCount += 1;
			if (result.hasInlineScript) inlineScriptCount += 1;
			if (result.category === "streaming_variant") streamingScriptCount += 1;
		}
	}

	return {
		scriptCount,
		enabledScriptCount,
		disabledScriptCount: scriptCount - enabledScriptCount,
		upgradableScriptCount,
		categories: REGEX_CATEGORY_ORDER.map((category) => ({
			category,
			scriptCount: categories.get(category)?.total ?? 0,
			enabledScriptCount: categories.get(category)?.enabled ?? 0,
			upgradableScriptCount: categories.get(category)?.upgradable ?? 0,
		})),
		deleteScopes: DELETE_SCOPE_ORDER.map((scope) => ({
			scope,
			scriptCount: scopes.get(scope) ?? 0,
		})),
		strategies: BLOCK_STRATEGY_ORDER.map((strategy) => ({
			strategy,
			scriptCount: strategies.get(strategy) ?? 0,
		})),
		topTags: [...tags.entries()]
			.map(([tag, scriptCount]) => ({ tag, scriptCount }))
			.sort(
				(left, right) =>
					right.scriptCount - left.scriptCount ||
					left.tag.localeCompare(right.tag),
			)
			.slice(0, 20),
		depthScopedScriptCount,
		inlineScriptCount,
		streamingScriptCount,
	};
}
