import type { StCharacterCard } from "../character-card.js";
import { buildMvuCardInitState } from "../st-mvu/initvar.js";
import { MvuLedgerSession, ST_MVU_PLUGIN_ID } from "../st-mvu/ledger.js";
import { parseMvuUpdate } from "../st-mvu/update.js";
import { worldInfoFromCharacterBook } from "../world-info.js";
import type {
	CoexistAfterTurnInput,
	CoexistApplyInput,
	CoexistApplyResult,
	CoexistPluginAdapter,
} from "./coexist.js";

/** 角色卡里 MVU 初始变量的来源：世界书条目名与开场白。 */
export function mvuInitVarSources(
	card: StCharacterCard,
): { name: string; content: string }[] {
	if (card.characterBook === null) return [];
	return worldInfoFromCharacterBook(card.characterBook, card.name).entries.map(
		(entry) => ({ name: entry.comment, content: entry.content }),
	);
}

function readInitState(card: StCharacterCard) {
	return buildMvuCardInitState({
		worldBookEntries: mvuInitVarSources(card),
		firstMessage: card.firstMessage,
	});
}

function applyStMvu(input: CoexistApplyInput): CoexistApplyResult {
	const init = readInitState(input.card);
	if (init.state === null) {
		return {
			notes: [
				`st-mvu：卡 ${input.card.name} 没有 [initvar] 初始变量，插件不改写任何内容`,
			],
		};
	}
	const variables = init.state.data;
	return {
		notes: [
			`st-mvu：初始变量来自 ${init.usedSources.length} 处（${init.usedSources.join("、")}），根级 ${Object.keys(variables).length} 个键`,
			...(init.issues.length === 0
				? []
				: [`st-mvu：初始变量有 ${init.issues.length} 条解析问题`]),
		],
	};
}

/**
 * MVU 的变量更新落在台账 `mvu` 命名空间：每轮回复里的 `<UpdateVariable>`
 * 经结算器校验后写成该楼层的 diff，原楼层原文不动（I4）。变量与台账是
 * 同一份数据，下一轮的 `state` 槽位就能读到。
 */
function applyMvuTurn(input: CoexistAfterTurnInput): readonly string[] {
	const node = input.store.getNode(input.nodeId);
	if (node === null) {
		throw new Error(`st-mvu 找不到刚写入的楼层 ${input.nodeId}`);
	}
	if (node.raw !== input.raw) {
		throw new Error(`st-mvu 发现楼层 ${input.nodeId} 的原文被改写`);
	}
	const init = readInitState(input.card);
	if (init.state === null) return [];
	const hasUpdate = /<UpdateVariable>/i.test(input.raw);
	const parsed = parseMvuUpdate(input.raw);
	const rejected: string[] = [];
	const session = MvuLedgerSession.open({
		store: input.store,
		nodeId: input.nodeId,
		state: init.state,
		onTrace: (entry) => {
			if (entry.outcome === "rejected") {
				rejected.push(entry.path?.join("/") ?? "-");
			}
		},
	});
	const applied = hasUpdate
		? session.apply(parsed.operations)
		: { applied: 0, rejected: [] };
	const commit = session.commit({ storyId: input.storyId });
	const notes: string[] = [];
	if (hasUpdate) {
		notes.push(
			`st-mvu：第 ${input.round} 轮按 ${parsed.operations.length} 条补丁写入 ${commit.accepted.length} 条变量事实`,
		);
	}
	const rejections = applied.rejected.length + commit.repairs.length;
	if (rejections > 0) {
		notes.push(
			`st-mvu：第 ${input.round} 轮拒绝 ${rejections} 条变量写入（${[...new Set(rejected)].join("、") || "路径未知"}）`,
		);
	}
	if (parsed.issues.length > 0 && hasUpdate) {
		notes.push(
			`st-mvu：第 ${input.round} 轮补丁有 ${parsed.issues.length} 条格式问题`,
		);
	}
	return notes;
}

/** `st-mvu` 在共存评测里的适配器：保持原生模板与槽位，只处理变量写入。 */
export const ST_MVU_COEXIST_PLUGIN: CoexistPluginAdapter = {
	id: ST_MVU_PLUGIN_ID,
	apply: applyStMvu,
	afterTurn: applyMvuTurn,
};
