// R1-T02.b：在 legacy 评测对话的最后一个楼层上离线统计块视图省略前后的 token。
// 固定窗口 20 楼，不调用模型，不写数据库。数字写进 docs/dev/reports/R1.md。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	DEFAULT_BLOCK_TYPES,
	DEFAULT_HISTORY_BLOCK_POLICY,
	createTokenEstimator,
	renderHistoryView,
} from "../../packages/core/dist/index.js";
import { parseChatJsonlFile } from "../../packages/st-compat/dist/chat-jsonl.js";
import { TAG_CATEGORIES } from "./f0-composition.mjs";

const ROOT = process.cwd();
const WINDOW_FLOORS = 20;

// 显示类块的口径取自 F0 的标签分类；st-compat 落地标签映射之前，
// core 的原生块类型里没有这些英文标签。
const DISPLAY_CLASS_CATEGORIES = new Set([
	"变量更新",
	"图片",
	"选项与交互输入",
	"分析与摘要",
]);

const knownNames = new Set(DEFAULT_BLOCK_TYPES.map((type) => type.name));
const legacyTypes = [];
for (const category of TAG_CATEGORIES) {
	if (!DISPLAY_CLASS_CATEGORIES.has(category.label)) continue;
	for (const name of category.names) {
		if (knownNames.has(name)) continue;
		knownNames.add(name);
		legacyTypes.push({
			name,
			display: { kind: "hidden" },
			context: { kind: "drop" },
			semantics: { kind: "none" },
		});
	}
}
const nativeTypes = [...DEFAULT_BLOCK_TYPES];
const mappedTypes = [...nativeTypes, ...legacyTypes];

const estimator = createTokenEstimator();

function countTokens(texts) {
	return texts.reduce((total, text) => total + estimator(text), 0);
}

const manifest = JSON.parse(
	readFileSync(join(ROOT, "eval-private/raw/manifest.json"), "utf8"),
);
const chats = manifest.files
	.filter((file) => file.role === "chat" && file.corpus === "legacy")
	.sort((left, right) => left.target.localeCompare(right.target));

const rows = [];
const omittedTotals = new Map();

for (const [index, chat] of chats.entries()) {
	const messages = [];
	for await (const entry of parseChatJsonlFile(
		join(ROOT, "eval-private/raw", chat.target),
		{ strictSwipeId: false },
	)) {
		if (entry.kind === "message") messages.push(entry.message);
	}
	if (messages.length === 0) throw new Error(`对话 ${index + 1} 没有楼层`);
	const window = messages.slice(-WINDOW_FLOORS);
	const floors = window.map((message, offset) => ({
		raw: message.text,
		depth: window.length - 1 - offset,
	}));

	const full = renderHistoryView(floors, {
		policy: { mode: "full", overrides: {} },
		types: nativeTypes,
		estimator,
	});
	const nativeDefault = renderHistoryView(floors, {
		policy: DEFAULT_HISTORY_BLOCK_POLICY,
		types: nativeTypes,
		estimator,
	});
	const mappedDefault = renderHistoryView(floors, {
		policy: DEFAULT_HISTORY_BLOCK_POLICY,
		types: mappedTypes,
		estimator,
	});

	const rawTokens = countTokens(floors.map((floor) => floor.raw));
	const fullTokens = countTokens(full.texts);
	const nativeTokens = countTokens(nativeDefault.texts);
	const mappedTokens = countTokens(mappedDefault.texts);
	for (const item of mappedDefault.trace.omitted) {
		const current = omittedTotals.get(item.blockType) ?? {
			characters: 0,
			tokens: 0,
		};
		current.characters += item.characters;
		current.tokens += item.tokens;
		omittedTotals.set(item.blockType, current);
	}
	rows.push({
		label: `对话 ${index + 1}`,
		floors: window.length,
		rawTokens,
		fullTokens,
		nativeTokens,
		mappedTokens,
		omittedCharacters: mappedDefault.trace.omitted.reduce(
			(total, item) => total + item.characters,
			0,
		),
	});
}

console.log(
	"| 对话 | 窗口楼层 | 原文 token | full 视图 token | default（原生块） | default（含标签映射） | 省略字符 | 省略占原文 |",
);
console.log("|---|---|---|---|---|---|---|---|");
for (const row of rows) {
	const ratio = ((row.rawTokens - row.mappedTokens) / row.rawTokens) * 100;
	console.log(
		`| ${row.label} | ${row.floors} | ${row.rawTokens} | ${row.fullTokens} | ${row.nativeTokens} | ${row.mappedTokens} | ${row.omittedCharacters} | ${ratio.toFixed(1)}% |`,
	);
}
const totals = rows.reduce(
	(accumulator, row) => ({
		floors: accumulator.floors + row.floors,
		rawTokens: accumulator.rawTokens + row.rawTokens,
		fullTokens: accumulator.fullTokens + row.fullTokens,
		nativeTokens: accumulator.nativeTokens + row.nativeTokens,
		mappedTokens: accumulator.mappedTokens + row.mappedTokens,
		omittedCharacters:
			accumulator.omittedCharacters + row.omittedCharacters,
	}),
	{
		floors: 0,
		rawTokens: 0,
		fullTokens: 0,
		nativeTokens: 0,
		mappedTokens: 0,
		omittedCharacters: 0,
	},
);
console.log(
	`| 合计 | ${totals.floors} | ${totals.rawTokens} | ${totals.fullTokens} | ${totals.nativeTokens} | ${totals.mappedTokens} | ${totals.omittedCharacters} | ${(((totals.rawTokens - totals.mappedTokens) / totals.rawTokens) * 100).toFixed(1)}% |`,
);

console.log("");
console.log("| 块类型 | 省略字符 | 估算省略 token |");
console.log("|---|---|---|");
for (const [blockType, stat] of [...omittedTotals.entries()].sort(
	(left, right) => right[1].characters - left[1].characters,
)) {
	console.log(`| ${blockType} | ${stat.characters} | ${stat.tokens} |`);
}
