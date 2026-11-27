import {
	type FloorRendererDefinition,
	escapeFloorHtml,
	isJsonObject,
} from "@dramaticer/core";
import { ST_HELPER_TAVERN_EVENTS } from "../st-helper-host/events.js";
import {
	ST_CONTENT_RENDERER_ID,
	ST_HELPER_RENDERER_ID,
	ST_RENDERER_PERMISSIONS,
	type StCardUiConfig,
} from "./config.js";
import { applyStDisplayRegexes, displayRegexPattern } from "./display.js";
import { buildStCardUiScript } from "./shim.js";

export const ST_CARD_UI_STYLE = `.st-card-ui { color: inherit; font: inherit; line-height: inherit; }
.st-card-ui #st-floor-root { white-space: pre-wrap; overflow-wrap: anywhere; }
.st-card-ui img { max-width: 100%; height: auto; }
.st-card-ui button { font: inherit; cursor: pointer; }`;

/**
 * 把 st-compat 的卡片配置变成原生楼层渲染器：显示层正则先变换原文，
 * 再套一层容器；助手脚本与交互桥垫片在同一 iframe 里运行。原文只读（I8）。
 */
export function createStCardFloorRenderer(
	config: StCardUiConfig | null,
): FloorRendererDefinition | null {
	if (config === null) return null;
	const regexActive = config.regexEnabled && config.regexes.length > 0;
	const helperActive = config.helperEnabled && config.scripts.length > 0;
	if (!regexActive && !helperActive) return null;
	const patterns: RegExp[] = [];
	if (regexActive) {
		for (const entry of config.regexes) {
			const pattern = displayRegexPattern(entry);
			if (pattern !== null) patterns.push(pattern);
		}
	}
	// 有启用的助手脚本时，楼层里没有正则命中也要进来跑一遍脚本。
	if (helperActive) patterns.push(/(?:)/);
	if (patterns.length === 0) return null;
	const id = helperActive ? ST_HELPER_RENDERER_ID : ST_CONTENT_RENDERER_ID;
	return {
		id,
		name: "酒馆卡片前端",
		patterns,
		permissions: [...ST_RENDERER_PERMISSIONS],
		render: (input) => {
			const transformed = regexActive
				? applyStDisplayRegexes(input.raw, config.regexes, config.characterName)
				: { text: input.raw, applied: false };
			const body = transformed.applied
				? transformed.text
				: escapeFloorHtml(transformed.text);
			const state = isJsonObject(input.state) ? input.state : null;
			const mvu = state !== null && isJsonObject(state.mvu) ? state.mvu : {};
			return {
				html: `<div class="st-card-ui"><div id="st-floor-root">${body}</div></div>`,
				style: ST_CARD_UI_STYLE,
				script: buildStCardUiScript({
					nodeId: input.nodeId,
					characterName: config.characterName,
					raw: input.raw,
					mvu,
					scripts: helperActive ? config.scripts : [],
					events: ST_HELPER_TAVERN_EVENTS,
				}),
			};
		},
	};
}
