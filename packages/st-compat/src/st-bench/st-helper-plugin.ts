import { PluginDisplayState } from "@dramaticer/core";
import { createStHelperHostSession } from "../st-helper-host/host.js";
import type { StHelperRenderRequest } from "../st-helper-host/html.js";
import { discoverStHelperScripts } from "../st-helper-host/scripts.js";
import type { CoexistAfterTurnInput, CoexistPluginAdapter } from "./coexist.js";
import { buildStContentCoexistResult } from "./st-content-plugin.js";

export const ST_HELPER_PLUGIN_ID = "st-helper-host";

/**
 * `st-helper-host` 在共存评测里的适配器。两组都用同一份 ST 内容映射，
 * 关闭组只去掉本插件。脚本在浏览器 iframe 里执行，Node 里的批次没有
 * iframe，所以开启组按回合做的宿主工作只有脚本库发现与状态栏渲染请求：
 * 两者都不进入 prompt、不写楼层原文与台账。评测因此验证的是宿主侧回合
 * 管线不会改变原生上下文；脚本执行本身由单元测试与浏览器用例覆盖。
 */
export const ST_HELPER_COEXIST_PLUGIN: CoexistPluginAdapter = {
	id: ST_HELPER_PLUGIN_ID,
	apply: (input) => buildStContentCoexistResult(input),
	baseline: (input) => buildStContentCoexistResult(input),
	afterTurn: (input: CoexistAfterTurnInput) => {
		const scripts = discoverStHelperScripts(input.card);
		const requests: StHelperRenderRequest[] = [];
		const displayState = new PluginDisplayState();
		const session = createStHelperHostSession({
			store: input.store,
			storyId: input.storyId,
			card: input.card,
			displayState,
			html: {
				start: (request) => {
					requests.push(request);
					return `bench-render-${requests.length}`;
				},
			},
		});
		try {
			const renderId = session.html?.renderStatusBar(input.nodeId) ?? null;
			const enabled = scripts.filter((script) => script.enabled).length;
			return [
				`${ST_HELPER_PLUGIN_ID}：脚本库 ${scripts.length} 条（启用 ${enabled} 条），状态栏渲染请求 ${requests.length} 次${renderId === null ? "" : "（等待 iframe）"}`,
			];
		} finally {
			session.dispose();
		}
	},
};
