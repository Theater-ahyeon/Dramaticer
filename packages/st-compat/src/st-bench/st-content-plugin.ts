import type {
	ContextSlotContent,
	ContextSlotProvider,
	ContextSlotRequest,
} from "@dramaticer/core";
import {
	buildStContentCompatReport,
	summarizeStContentCompatReport,
} from "../st-content/compat-report.js";
import { createStMacroEngine } from "../st-content/macros.js";
import {
	ST_CONTENT_TEMPLATE_ID,
	createStHistoryProvider,
	mapStPreset,
} from "../st-content/preset-mapping.js";
import { collectStRegexScripts } from "../st-content/regex.js";
import { createStWorldInfoProviders } from "../st-content/world-info-activation.js";
import { worldInfoFromCharacterBook } from "../world-info.js";
import type {
	CoexistApplyInput,
	CoexistApplyResult,
	CoexistPluginAdapter,
} from "./coexist.js";

export const ST_CONTENT_PLUGIN_ID = "st-content";
/** 槽位提供者在 Trace 里的来源前缀，用于区分 ST 内容与原生内容。 */
export const ST_CONTENT_TRACE_SOURCE = "st-content";

function tagProviderSource(
	base: ContextSlotProvider,
	prefix: string,
): ContextSlotProvider {
	return {
		get packKey() {
			return base.packKey;
		},
		...(base.plugin === undefined ? {} : { plugin: base.plugin }),
		async provide(
			request: ContextSlotRequest,
		): Promise<ContextSlotContent | null> {
			const content = await base.provide(request);
			if (content === null) return null;
			return { ...content, source: `${prefix}：${content.source}` };
		},
	};
}

function applyStContent(input: CoexistApplyInput): CoexistApplyResult {
	const preset = input.preset;
	if (preset === null) {
		throw new Error(
			`st-content 共存评测需要为卡 ${input.card.name} 配置预设文件`,
		);
	}
	const macros = createStMacroEngine({
		char: input.card.name,
		card: {
			charPrompt: input.card.systemPrompt,
			charJailbreak: input.card.postHistoryInstructions,
			description: input.card.description,
			personality: input.card.personality,
			scenario: input.card.scenario,
			mesExamples: input.card.messageExample,
			charVersion: input.card.characterVersion,
			creatorNotes: input.card.creatorNotes,
		},
		messages: input.store.getPathToHead(input.storyId).map((node) => ({
			text: node.raw,
			isUser: node.role === "user",
			isSystem: node.role === "system",
			sendDate: node.createdAt,
		})),
	});
	const mapping = mapStPreset({
		preset,
		card: input.card,
		structuredOutput: input.structuredOutput,
		macros,
		templateId: ST_CONTENT_TEMPLATE_ID,
	});
	const report = buildStContentCompatReport({
		preset,
		card: input.card,
		mapping,
	});
	let providers = input.providers;
	const worlds =
		input.card.characterBook === null
			? []
			: [worldInfoFromCharacterBook(input.card.characterBook, input.card.name)];
	if (worlds.length > 0) {
		const worldInfo = createStWorldInfoProviders({
			worlds,
			store: input.store,
			wiFormat: mapping.formats.worldInfo,
			includeBefore: mapping.worldInfo.before,
			includeAfter: mapping.worldInfo.after,
			regexScripts: collectStRegexScripts({
				preset: preset.regexScripts,
				allowPreset: true,
			}),
		});
		const baseHistory = providers.history;
		if (baseHistory !== undefined) {
			providers = {
				...providers,
				history: worldInfo.wrapHistory(baseHistory),
			};
		}
		providers = {
			...providers,
			lore: tagProviderSource(worldInfo.lore, ST_CONTENT_TRACE_SOURCE),
		};
	}
	if (mapping.injections.length > 0) {
		const baseHistory = providers.history;
		if (baseHistory === undefined) {
			throw new Error("st-content 的深度注入需要 history 槽位");
		}
		providers = {
			...providers,
			history: createStHistoryProvider(baseHistory, mapping.injections),
		};
	}
	return {
		template: mapping.template,
		providers,
		notes: [summarizeStContentCompatReport(report)],
	};
}

/**
 * `st-content` 在共存评测里的适配器：关闭组用默认模板与槽位，开启组用
 * 预设转换出的模板、世界书提供者与深度注入。只改写模板与槽位。
 */
export const ST_CONTENT_COEXIST_PLUGIN: CoexistPluginAdapter = {
	id: ST_CONTENT_PLUGIN_ID,
	apply: applyStContent,
};
