import { type TokenEstimator, createTokenEstimator } from "@dramaticer/core";
import type { AcuBaseline, AcuScore } from "../evalset/acu.js";
import type { QuestionKind } from "../evalset/question-files.js";
import type {
	RetrievalBaseline,
	RetrievalKindScore,
	RetrievalScore,
} from "../evalset/retrieval.js";
import type { ChatHealth } from "./chat-health.js";
import { analyzeChat } from "./chat-health.js";
import type { EntityHealth } from "./entity-health.js";
import { analyzeEntityFiles } from "./entity-health.js";
import {
	STORY_CORPORA,
	type StoryCorpus,
	openSnapshot,
	storyCorpus,
} from "./manifest.js";
import type { PresetHealth } from "./preset-health.js";
import { analyzePresets, parsePresetFiles } from "./preset-health.js";
import type { RegexHealth } from "./regex-health.js";
import {
	BLOCK_STRATEGY_LABELS,
	DELETE_SCOPE_LABELS,
	REGEX_CATEGORY_LABELS,
	analyzeRegexScripts,
} from "./regex-health.js";

export interface ChatReportEntry {
	readonly character: string | null;
	readonly fileName: string;
	readonly corpus: StoryCorpus;
	readonly stats: ChatHealth;
}

export interface HealthTotals {
	readonly chatCount: number;
	readonly messageCount: number;
	readonly swipeCount: number;
	readonly fileBytes: number;
	readonly headerBytes: number;
	readonly bodyBytes: number;
	readonly variablesBytes: number;
	readonly otherBytes: number;
	readonly bodyTokens: number;
	readonly variablesTokens: number;
	readonly otherTokens: number;
	readonly snapshotBytes: number;
	readonly diffBytes: number;
	readonly diffCount: number;
}

export interface HealthReport {
	readonly generatedAt: string;
	readonly manifestGeneratedAt: string | null;
	readonly chats: readonly ChatReportEntry[];
	readonly entities: EntityHealth;
	readonly presets: PresetHealth;
	readonly regex: RegexHealth;
	readonly totals: HealthTotals;
}

export interface CollectHealthReportOptions {
	readonly rawRoot: string;
	readonly tokenEstimator?: TokenEstimator;
	readonly generatedAt?: string;
}

export async function collectHealthReport(
	options: CollectHealthReportOptions,
): Promise<HealthReport> {
	const snapshot = await openSnapshot(options.rawRoot);
	const tokenEstimator = options.tokenEstimator ?? createTokenEstimator();
	const chatFiles = snapshot.filesByRole("chat");
	const cardFiles = snapshot.filesByRole("card");
	const worldFiles = snapshot.filesByRole("worldbook");
	const presetFiles = snapshot.filesByRole("preset");
	if (chatFiles.length === 0) {
		throw new Error("manifest 里没有 chat");
	}

	const chats: ChatReportEntry[] = [];
	for (const file of chatFiles) {
		chats.push({
			character: file.character ?? null,
			fileName: file.target,
			corpus: storyCorpus(file),
			stats: await analyzeChat(await snapshot.resolveFile(file), {
				tokenEstimator,
			}),
		});
	}

	const entities = await analyzeEntityFiles(
		await Promise.all(cardFiles.map((file) => snapshot.resolveFile(file))),
		await Promise.all(worldFiles.map((file) => snapshot.resolveFile(file))),
	);
	const presetList = await parsePresetFiles(
		await Promise.all(presetFiles.map((file) => snapshot.resolveFile(file))),
	);
	const presets = analyzePresets(presetList, tokenEstimator);
	const regex = analyzeRegexScripts(presetList);

	return {
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		manifestGeneratedAt: snapshot.manifest.generatedAt,
		chats,
		entities,
		presets,
		regex,
		totals: sumChats(chats),
	};
}

export function renderPrivateReport(
	report: HealthReport,
	retrieval?: RetrievalBaseline,
	acu?: AcuBaseline,
): string {
	const lines: string[] = [];
	lines.push("# M0 私有体检报告", "");
	lines.push(`生成时间：${report.generatedAt}`);
	if (report.manifestGeneratedAt) {
		lines.push(`快照生成时间：${report.manifestGeneratedAt}`);
	}
	lines.push(
		`数据源：${report.chats.length} 个对话、${report.entities.cards.length} 张卡、${report.entities.worlds.length} 本世界书、${report.presets.presetCount} 个预设。`,
	);
	lines.push("");
	lines.push("## 对话");
	lines.push("");
	lines.push(
		"| 语料 | 角色 | 文件 | 楼层 | 用户 | 助手 | system | swipe | 文件字节 | 正文字节 | 变量字节 | 其他字节 |",
		"|---|---|---|---|---|---|---|---|---|---|---|---|",
	);
	for (const chat of report.chats) {
		const stats = chat.stats;
		lines.push(
			`| ${corpusLabel(chat.corpus)} | ${cell(chat.character ?? "未知")} | ${cell(chat.fileName)} | ${stats.messageCount} | ${stats.roleCounts.user} | ${stats.roleCounts.assistant} | ${stats.roleCounts.system} | ${stats.swipeCount} | ${stats.fileBytes} | ${stats.bodyBytes} | ${stats.variablesBytes} | ${stats.otherBytes} |`,
		);
	}
	lines.push("");
	lines.push("## 每对话细节");
	for (const chat of report.chats) {
		lines.push("");
		lines.push(`### ${chat.character ?? "未知角色"}`);
		lines.push("");
		lines.push(`- 文件：${chat.fileName}`);
		lines.push(`- 语料：${corpusLabel(chat.corpus)}`);
		lines.push(`- 文件字节：${chat.stats.fileBytes}`);
		lines.push(`- 消息序列化后的字节：${chat.stats.rawBytes}`);
		lines.push(`- 头部字节：${chat.stats.headerBytes}`);
		lines.push(`- 正文 token：${chat.stats.bodyTokens}`);
		lines.push(`- 全部 swipe 正文字节：${chat.stats.swipeBodyBytes}`);
		lines.push(`- 全部 swipe 正文 token：${chat.stats.swipeBodyTokens}`);
		lines.push(`- 变量字节：${chat.stats.variablesBytes}`);
		lines.push(`- 变量 token：${chat.stats.variablesTokens}`);
		lines.push(`- 其他字节：${chat.stats.otherBytes}`);
		lines.push(`- 其他 token：${chat.stats.otherTokens}`);
		lines.push(`- 主路径快照字节：${chat.stats.snapshotBytes}`);
		lines.push(`- 全部物理快照字节：${chat.stats.allSnapshotBytes}`);
		lines.push(
			`- diff 条数：${chat.stats.diffCount}，diff 字节：${chat.stats.diffBytes}，diff/快照：${formatPercent(ratio(chat.stats.diffBytes, chat.stats.snapshotBytes))}`,
		);
		lines.push(`- 助手回复数：${chat.stats.assistantReplyCount}`);
		lines.push(
			`- 重复度：相邻 ${chat.stats.duplication.pairs.length} 对，${chat.stats.duplication.ngramSize}-gram，平均 ${formatDecimal(meanSimilarity(chat.stats))}，持续上升起点：${chat.stats.duplication.riseStartFloor === null ? "无" : `第 ${chat.stats.duplication.riseStartFloor} 楼`}`,
		);
		if (chat.stats.duplication.peakWindow) {
			const peak = chat.stats.duplication.peakWindow;
			lines.push(
				`- 峰值窗口：第 ${peak.startFloor}–${peak.endFloor} 楼，均值 ${formatDecimal(peak.meanSimilarity)}`,
			);
		}
		lines.push("");
		lines.push("其他字段前 10：");
		lines.push("");
		lines.push("| 字段 | 字节 | 占其他比例 |");
		lines.push("|---|---|---|");
		for (const field of chat.stats.fieldBytes) {
			lines.push(
				`| ${cell(field.field)} | ${field.bytes} | ${formatPercent(ratio(field.bytes, chat.stats.otherBytes))} |`,
			);
		}
		if (chat.stats.duplication.windows.length > 0) {
			lines.push("");
			lines.push("重复度窗口：");
			lines.push("");
			lines.push("| 起始楼层 | 结束楼层 | 均值 |");
			lines.push("|---|---|---|");
			for (const window of chat.stats.duplication.windows) {
				lines.push(
					`| ${window.startFloor} | ${window.endFloor} | ${formatDecimal(window.meanSimilarity)} |`,
				);
			}
		}
	}
	lines.push("");
	lines.push("## 角色卡");
	lines.push("");
	lines.push("| 名称 | 规范 | 标签 | 备用开场 | 群聊开场 | 内嵌条目 |");
	lines.push("|---|---|---|---|---|---|");
	for (const card of report.entities.cards) {
		lines.push(
			`| ${cell(card.name)} | ${card.spec} | ${card.tagCount} | ${card.alternateGreetingCount} | ${card.groupOnlyGreetingCount} | ${card.embeddedBookEntryCount} |`,
		);
	}
	for (const card of report.entities.cards) {
		lines.push("");
		lines.push(`### 卡：${card.name}`);
		lines.push("");
		lines.push("| 字段 | 字节 |");
		lines.push("|---|---|");
		for (const field of card.fieldBytes) {
			lines.push(`| ${cell(field.field)} | ${field.bytes} |`);
		}
	}
	lines.push("");
	lines.push("## 世界书");
	lines.push("");
	lines.push(
		"| 名称 | 条目 | 启用 | 常驻 | 主关键词 | 次关键词 | 去重主关键词 | 正文字节 |",
		"|---|---|---|---|---|---|---|---|",
	);
	for (const world of report.entities.worlds) {
		lines.push(
			`| ${cell(world.name ?? "未知")} | ${world.entryCount} | ${world.enabledEntryCount} | ${world.constantEntryCount} | ${world.primaryKeywordCount} | ${world.secondaryKeywordCount} | ${world.distinctPrimaryKeywordCount} | ${world.contentBytes} |`,
		);
	}
	lines.push("");
	lines.push("## 预设");
	lines.push("");
	renderPresetDetails(lines, report.presets);
	lines.push("");
	lines.push("## 正则分类");
	lines.push("");
	renderRegexDetails(lines, report.regex, true);
	if (retrieval) {
		lines.push("");
		renderRetrievalSection(lines, retrieval, true);
	}
	if (acu) {
		lines.push("");
		renderAcuSection(lines, acu, true);
	}
	return `${lines.join("\n")}\n`;
}

export function renderPublicReport(
	report: HealthReport,
	retrieval?: RetrievalBaseline,
	acu?: AcuBaseline,
): string {
	const lines: string[] = [];
	lines.push("# M0 体检报告（统计版）", "");
	lines.push(`生成时间：${report.generatedAt}`);
	lines.push(
		`数据源：${report.totals.chatCount} 个对话、${report.entities.totals.cardCount} 张角色卡、${report.entities.totals.worldCount} 本世界书、${report.presets.presetCount} 个预设。`,
	);
	lines.push("");
	lines.push(
		"字节按 UTF-8 计算。头部是对话第一行的序列化字节，正文是当前 swipe 的原文，变量是消息里物理存储的 `variables`（包含所有 swipe），其他是消息对象重新序列化之后减去前两项。文件字节与前三项之和的差额是行分隔符。token 估算按中文 1.5 个字符算 1 个 token、其余字符 4 个算 1 个。",
	);
	lines.push("");
	lines.push("## 对话体量");
	lines.push("");
	for (const group of groupChats(report.chats)) {
		const totals = sumChats(group.chats);
		lines.push(
			`### ${corpusLabel(group.corpus)}（${group.chats.length} 个对话）`,
		);
		lines.push("");
		lines.push(
			"| 对话 | 楼层 | 用户 | 助手 | system | swipe | 文件字节 | 头部字节 | 正文字节 | 变量字节 | 其他字节 | 正文 token | 变量 token | 其他 token |",
			"|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
		);
		group.chats.forEach((chat, index) => {
			const stats = chat.stats;
			lines.push(
				`| ${corpusRowLabel(group.corpus, index + 1)} | ${stats.messageCount} | ${stats.roleCounts.user} | ${stats.roleCounts.assistant} | ${stats.roleCounts.system} | ${stats.swipeCount} | ${stats.fileBytes} | ${stats.headerBytes} | ${stats.bodyBytes} | ${stats.variablesBytes} | ${stats.otherBytes} | ${stats.bodyTokens} | ${stats.variablesTokens} | ${stats.otherTokens} |`,
			);
		});
		lines.push(
			`| ${corpusLabel(group.corpus)}合计（${totals.chatCount} 个对话） | ${totals.messageCount} | ${sumRole(group.chats, "user")} | ${sumRole(group.chats, "assistant")} | ${sumRole(group.chats, "system")} | ${totals.swipeCount} | ${totals.fileBytes} | ${totals.headerBytes} | ${totals.bodyBytes} | ${totals.variablesBytes} | ${totals.otherBytes} | ${totals.bodyTokens} | ${totals.variablesTokens} | ${totals.otherTokens} |`,
		);
		lines.push("");
	}
	lines.push("其他字段里占比最大的字段（全部对话合计，不含正文和变量）：");
	lines.push("");
	lines.push("| 字段 | 字节 | 占其他比例 |");
	lines.push("|---|---|---|");
	for (const field of aggregateFields(report.chats)) {
		lines.push(
			`| ${cell(field.field)} | ${field.bytes} | ${formatPercent(ratio(field.bytes, report.totals.otherBytes))} |`,
		);
	}
	lines.push("");
	lines.push("## 状态存储");
	lines.push("");
	for (const group of groupChats(report.chats)) {
		const totals = sumChats(group.chats);
		lines.push(`### ${corpusLabel(group.corpus)}`);
		lines.push("");
		lines.push(
			"| 对话 | 主路径快照字节 | 原生 diff 字节 | diff 条数 | diff/快照 |",
			"|---|---|---|---|---|",
		);
		group.chats.forEach((chat, index) => {
			const stats = chat.stats;
			lines.push(
				`| ${corpusRowLabel(group.corpus, index + 1)} | ${stats.snapshotBytes} | ${stats.diffBytes} | ${stats.diffCount} | ${formatPercent(ratio(stats.diffBytes, stats.snapshotBytes))} |`,
			);
		});
		lines.push(
			`| ${corpusLabel(group.corpus)}合计 | ${totals.snapshotBytes} | ${totals.diffBytes} | ${totals.diffCount} | ${formatPercent(ratio(totals.diffBytes, totals.snapshotBytes))} |`,
		);
		lines.push("");
	}
	lines.push("## 重复度");
	lines.push("");
	lines.push(
		`相邻 AI 回复的字符 n-gram Jaccard 相似度：${ngramDescription(report)}。窗口均值按连续窗口统计，持续上升指连续 5 个窗口不下降且首尾上涨至少 0.02，起点均值不低于 0.03。`,
	);
	lines.push("");
	for (const group of groupChats(report.chats)) {
		lines.push(`### ${corpusLabel(group.corpus)}`);
		lines.push("");
		lines.push(
			"| 对话 | 相邻回复对 | 平均相似度 | 峰值窗口 | 峰值均值 | 持续上升起点 |",
		);
		lines.push("|---|---|---|---|---|---|");
		group.chats.forEach((chat, index) => {
			const duplication = chat.stats.duplication;
			const peak = duplication.peakWindow;
			lines.push(
				`| ${corpusRowLabel(group.corpus, index + 1)} | ${duplication.pairs.length} | ${formatDecimal(meanSimilarity(chat.stats))} | ${peak ? `${peak.startFloor}–${peak.endFloor} 楼` : "无"} | ${peak ? formatDecimal(peak.meanSimilarity) : "无"} | ${duplication.riseStartFloor === null ? "无" : `第 ${duplication.riseStartFloor} 楼`} |`,
			);
		});
		lines.push("");
	}
	lines.push("## 实体");
	lines.push("");
	lines.push("| 指标 | 数量 |");
	lines.push("|---|---|");
	lines.push(`| 角色卡 | ${report.entities.totals.cardCount} |`);
	lines.push(`| 世界书 | ${report.entities.totals.worldCount} |`);
	lines.push(`| 世界书条目 | ${report.entities.totals.worldEntryCount} |`);
	lines.push(
		`| 启用的世界书条目 | ${report.entities.totals.enabledWorldEntryCount} |`,
	);
	lines.push(
		`| 常驻世界书条目 | ${report.entities.totals.constantWorldEntryCount} |`,
	);
	lines.push(
		`| 去重后的主关键词 | ${report.entities.totals.distinctPrimaryKeywordCount} |`,
	);
	lines.push(
		`| 卡内嵌世界书条目 | ${report.entities.totals.embeddedBookEntryCount} |`,
	);
	lines.push("");
	lines.push("| 卡 | 规范 | 标签 | 备用开场 | 群聊开场 | 内嵌条目 |");
	lines.push("|---|---|---|---|---|---|");
	report.entities.cards.forEach((card, index) => {
		lines.push(
			`| 卡 ${index + 1} | ${card.spec} | ${card.tagCount} | ${card.alternateGreetingCount} | ${card.groupOnlyGreetingCount} | ${card.embeddedBookEntryCount} |`,
		);
	});
	lines.push("");
	lines.push("## 预设");
	lines.push("");
	lines.push("| 指标 | 数量 |");
	lines.push("|---|---|");
	lines.push(`| 预设 | ${report.presets.presetCount} |`);
	lines.push(`| 提示词条目 | ${report.presets.promptCount} |`);
	lines.push(`| 启用的提示词条目 | ${report.presets.enabledPromptCount} |`);
	lines.push(`| marker 条目 | ${report.presets.markerPromptCount} |`);
	lines.push(`| 提示词正文字节 | ${report.presets.promptContentBytes} |`);
	lines.push(`| 提示词正文 token | ${report.presets.promptContentTokens} |`);
	lines.push(
		`| 带 assistant prefill 的预设 | ${report.presets.presetsWithAssistantPrefill} |`,
	);
	lines.push(
		`| 无法识别的 \`{{...}}\` | ${report.presets.unrecognizedMacroOccurrences} |`,
	);
	lines.push(`| 正则脚本 | ${report.presets.regexScriptCount} |`);
	lines.push(`| 停用的正则脚本 | ${report.presets.disabledRegexScriptCount} |`);
	lines.push("");
	lines.push("宏的使用频率（提示词正文，前 20）：");
	lines.push("");
	lines.push("| 宏 | 次数 | 涉及预设 |");
	lines.push("|---|---|---|");
	for (const macro of report.presets.macros.slice(0, 20)) {
		lines.push(
			`| ${cell(macro.name)} | ${macro.count} | ${macro.presetCount} |`,
		);
	}
	lines.push("");
	lines.push("正则作用范围：");
	lines.push("");
	lines.push("| 作用范围 | 脚本数 |");
	lines.push("|---|---|");
	for (const placement of report.presets.placements) {
		lines.push(`| ${cell(placement.label)} | ${placement.scriptCount} |`);
	}
	lines.push("");
	lines.push("正则开关与范围标记：");
	lines.push("");
	lines.push("| 标记 | 脚本数 |");
	lines.push("|---|---|");
	lines.push(`| markdownOnly | ${report.presets.markdownOnlyCount} |`);
	lines.push(`| promptOnly | ${report.presets.promptOnlyCount} |`);
	lines.push(`| runOnEdit | ${report.presets.runOnEditCount} |`);
	lines.push(`| 带深度限制 | ${report.presets.depthLimitedCount} |`);
	lines.push("");
	lines.push("findRegex 参数替换方式：");
	lines.push("");
	lines.push("| 方式 | 脚本数 |");
	lines.push("|---|---|");
	for (const substitute of report.presets.substituteRegex) {
		lines.push(`| ${cell(substitute.label)} | ${substitute.scriptCount} |`);
	}
	lines.push("");
	lines.push("## 正则分类");
	lines.push("");
	renderRegexDetails(lines, report.regex, false);
	if (retrieval) {
		lines.push("");
		renderRetrievalSection(lines, retrieval, false);
	}
	if (acu) {
		lines.push("");
		renderAcuSection(lines, acu, false);
	}
	lines.push("");
	lines.push("## 方法");
	lines.push("");
	lines.push(
		"- 原生 diff 按 ADR-0005 的规则从相邻楼层快照生成，每条 diff 序列化为 `[path, op, value]` 后计字节。",
	);
	lines.push(
		"- 重复度按 Unicode 字符切分，默认 4-gram；窗口大小 20 对相邻回复，步长 10。",
	);
	lines.push(
		"- 实体数量是原始计数：世界书条目、启用的条目、去重后的主关键词、卡内嵌的条目。",
	);
	lines.push(
		"- 宏名取 `{{...}}` 里 `::` 之前、空白之前的第一个词，只统计英文字母开头的标识符；`{{// ...}}` 统一记为 `//`，其余写法计入无法识别的次数。",
	);
	lines.push(
		"- 正则分类按 findRegex 与 replaceString 的结构判定，判定顺序依次是流式版本、内联脚本、渲染 HTML、删除思考链、删除内容、重排捕获内容、文本替换。可升级指这条正则能改由块策略、渲染器或沙箱渲染器承担；比例按启用的脚本计算。",
	);
	lines.push(
		"- ACU 对照组的表格内容来自对话头部的 `sheets` 单元格历史与逐楼层 `hash_sheets`、消息里的 `TavernDB_ACU_Data`，以及 `TavernDB_ACU_IsolatedData` 里记录的 SQL 更新。SQL 更新在内存 SQLite 里按楼层顺序重放；每个单元格和答案都做 NFKC 规范化、去掉空白与标点，再判断答案是否出现在某一个单元格里。",
	);
	lines.push(
		"- 对话按 manifest 的语料分组分栏：旧语料是原有的 3 个对话，新增语料是按修改时间取样的对话。统计版只出现分组名与组内序号。",
	);
	lines.push(
		"- 新增语料只生成了状态题。事件题请求估算按每个窗口一次请求计算，不含缓存命中；本报告不调用模型出题。",
	);
	return `${lines.join("\n")}\n`;
}

function renderRetrievalSection(
	lines: string[],
	retrieval: RetrievalBaseline,
	privateView: boolean,
): void {
	lines.push("## 检索基线（BM25）");
	lines.push("");
	lines.push(
		`分块：固定窗口 ${retrieval.maxChars} 字符、重叠 ${retrieval.overlapChars} 字符，按 FTS5 trigram 建索引。写入与查询都先做 NFKC 规范化并去掉标点、符号和空白；同一楼层的多个块只占一个位次。每道题只在提问楼层之前的楼层里检索；证据楼层出现在前 K 个结果里算命中。`,
	);
	lines.push("");
	lines.push(
		"| 语料 | 对话 | 已评测 | 未评测 | 状态题 | 事件题 | 事件题请求估算 | 题数 | 命中@5 | 命中@10 | 命中@20 |",
	);
	lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
	for (const corpus of retrieval.corpora) {
		lines.push(
			`| ${corpusLabel(corpus.corpus)} | ${corpus.chatCount} | ${corpus.chatCount - corpus.skippedStoryCount} | ${corpus.skippedStoryCount} | ${kindQuestionCount(corpus.byKind, "state")} | ${kindQuestionCount(corpus.byKind, "event")} | ${corpus.eventQuestionRequestEstimate} | ${corpus.total.questionCount} | ${corpus.total.hitAt5} | ${corpus.total.hitAt10} | ${corpus.total.hitAt20} |`,
		);
	}
	for (const corpus of retrieval.corpora) {
		const corpusStories = retrieval.stories.filter(
			(story) => story.corpus === corpus.corpus,
		);
		const skipped = retrieval.skippedStories.filter(
			(story) => story.corpus === corpus.corpus,
		);
		lines.push("");
		lines.push(`### ${corpusLabel(corpus.corpus)}`);
		lines.push("");
		if (corpusStories.length > 0) {
			lines.push("| 对话 | 楼层 | 块数 |");
			lines.push("|---|---|---|");
			corpusStories.forEach((story, index) => {
				const label = privateView
					? cell(story.story)
					: corpusRowLabel(story.corpus, index + 1);
				lines.push(`| ${label} | ${story.floorCount} | ${story.chunkCount} |`);
			});
			lines.push("");
			lines.push("| 对话 | 题目类型 | 题数 | 命中@5 | 命中@10 | 命中@20 |");
			lines.push("|---|---|---|---|---|---|");
			corpusStories.forEach((story, index) => {
				const label = privateView
					? cell(story.story)
					: corpusRowLabel(story.corpus, index + 1);
				for (const score of story.byKind) {
					lines.push(
						scoreRow(
							label,
							score.kind === "state" ? "状态题" : "事件题",
							score,
						),
					);
				}
				lines.push(scoreRow(label, "全部", story.total));
			});
			for (const score of corpus.byKind) {
				lines.push(
					scoreRow(
						`${corpusLabel(corpus.corpus)}合计`,
						score.kind === "state" ? "状态题" : "事件题",
						score,
					),
				);
			}
			lines.push(
				scoreRow(`${corpusLabel(corpus.corpus)}合计`, "全部", corpus.total),
			);
		} else {
			lines.push("没有可评测的对话。");
		}
		if (skipped.length > 0) {
			lines.push("");
			if (privateView) {
				lines.push(
					`未评测：${skipped
						.map((story) => `${cell(story.story)}（${story.reason}）`)
						.join("、")}`,
				);
			} else {
				lines.push(`未评测：${skipped.length} 个对话`);
			}
		}
	}
}

function kindQuestionCount(
	scores: readonly RetrievalKindScore[],
	kind: QuestionKind,
): number {
	return scores.find((score) => score.kind === kind)?.questionCount ?? 0;
}

function scoreRow(
	label: string,
	questionType: string,
	score: RetrievalScore,
): string {
	const hits = [score.hitAt5, score.hitAt10, score.hitAt20]
		.map((hit) => `${hit}（${formatPercent(ratio(hit, score.questionCount))}）`)
		.join(" | ");
	return `| ${label} | ${questionType} | ${score.questionCount} | ${hits} |`;
}

function renderAcuSection(
	lines: string[],
	acu: AcuBaseline,
	privateView: boolean,
): void {
	lines.push("## ACU 对照组（表格覆盖）");
	lines.push("");
	lines.push(
		"在提问楼层之前最近的 ACU 表格内容里查找标准答案：每个单元格和答案都做 NFKC 规范化、去掉空白与标点符号之后，判断答案是否出现在某一个单元格里；相邻单元格不会被拼成一段文本。没有表格数据的对话记为“不适用”，不进入合计。",
	);
	lines.push("");
	lines.push("| 语料 | 对话 | 已评测 | 未评测 | 题数 | 覆盖 | 覆盖率 |");
	lines.push("|---|---|---|---|---|---|---|");
	for (const corpus of acu.corpora) {
		lines.push(
			`| ${corpusLabel(corpus.corpus)} | ${corpus.chatCount} | ${corpus.chatCount - corpus.skippedStoryCount} | ${corpus.skippedStoryCount} | ${corpus.questionCount} | ${corpus.coveredCount} | ${formatPercent(ratio(corpus.coveredCount, corpus.questionCount))} |`,
		);
	}
	for (const corpus of acu.corpora) {
		const corpusStories = acu.stories.filter(
			(story) => story.corpus === corpus.corpus,
		);
		const skipped = acu.skippedStories.filter(
			(story) => story.corpus === corpus.corpus,
		);
		lines.push("");
		lines.push(`### ${corpusLabel(corpus.corpus)}`);
		lines.push("");
		if (corpusStories.length > 0) {
			lines.push("| 对话 | 题数 | 有表格内容的提问楼层 | 覆盖 | 覆盖率 |");
			lines.push("|---|---|---|---|---|");
			corpusStories.forEach((story, index) => {
				const label = privateView
					? cell(story.story)
					: corpusRowLabel(story.corpus, index + 1);
				if (!story.applicable) {
					lines.push(`| ${label} | 不适用 | 0 | 0 | 不适用 |`);
					return;
				}
				lines.push(
					`| ${label} | ${story.questionCount} | ${story.snapshotFloorCount} | ${story.coveredCount} | ${formatPercent(ratio(story.coveredCount, story.questionCount))} |`,
				);
			});
			lines.push(
				`| ${corpusLabel(corpus.corpus)}合计 | ${corpus.questionCount} | — | ${corpus.coveredCount} | ${formatPercent(ratio(corpus.coveredCount, corpus.questionCount))} |`,
			);
			lines.push("");
			lines.push("| 对话 | 题目类型 | 题数 | 覆盖 | 覆盖率 |");
			lines.push("|---|---|---|---|---|");
			corpusStories.forEach((story, index) => {
				if (!story.applicable) return;
				const label = privateView
					? cell(story.story)
					: corpusRowLabel(story.corpus, index + 1);
				for (const score of story.byKind) {
					lines.push(acuScoreRow(label, score.kind, score));
				}
			});
			for (const score of corpus.byKind) {
				lines.push(
					acuScoreRow(`${corpusLabel(corpus.corpus)}合计`, score.kind, score),
				);
			}
			lines.push("");
			lines.push("按规范化之后的答案长度：");
			lines.push("");
			lines.push("| 答案长度 | 题数 | 覆盖 | 覆盖率 |");
			lines.push("|---|---|---|---|");
			for (const score of corpus.byAnswerLength) {
				lines.push(
					`| ${cell(score.label)} | ${score.questionCount} | ${score.coveredCount} | ${formatPercent(ratio(score.coveredCount, score.questionCount))} |`,
				);
			}
		} else {
			lines.push("没有可评测的对话。");
		}
		if (skipped.length > 0) {
			lines.push("");
			if (privateView) {
				lines.push(
					`未评测：${skipped
						.map((story) => `${cell(story.story)}（${story.reason}）`)
						.join("、")}`,
				);
			} else {
				lines.push(`未评测：${skipped.length} 个对话`);
			}
		}
	}
}

function acuScoreRow(
	label: string,
	kind: "state" | "event",
	score: AcuScore,
): string {
	const typeLabel = kind === "state" ? "状态题" : "事件题";
	return `| ${label} | ${typeLabel} | ${score.questionCount} | ${score.coveredCount} | ${formatPercent(ratio(score.coveredCount, score.questionCount))} |`;
}

function renderPresetDetails(lines: string[], presets: PresetHealth): void {
	lines.push(`- 预设数：${presets.presetCount}`);
	lines.push(
		`- 提示词条目：${presets.promptCount}（启用 ${presets.enabledPromptCount}，marker ${presets.markerPromptCount}）`,
	);
	lines.push(
		`- 提示词正文字节：${presets.promptContentBytes}，token：${presets.promptContentTokens}`,
	);
	lines.push(
		`- 正则脚本：${presets.regexScriptCount}（停用 ${presets.disabledRegexScriptCount}）`,
	);
	lines.push(
		`- 无法识别的 \`{{...}}\` 次数：${presets.unrecognizedMacroOccurrences}`,
	);
	lines.push("");
	lines.push("宏：");
	lines.push("");
	lines.push("| 宏 | 次数 | 涉及预设 |");
	lines.push("|---|---|---|");
	for (const macro of presets.macros) {
		lines.push(
			`| ${cell(macro.name)} | ${macro.count} | ${macro.presetCount} |`,
		);
	}
	lines.push("");
	lines.push("正则作用范围：");
	lines.push("");
	lines.push("| 作用范围 | 脚本数 |");
	lines.push("|---|---|");
	for (const placement of presets.placements) {
		lines.push(`| ${cell(placement.label)} | ${placement.scriptCount} |`);
	}
	lines.push("");
	lines.push("正则标记：");
	lines.push("");
	lines.push(
		`- markdownOnly：${presets.markdownOnlyCount}`,
		`- promptOnly：${presets.promptOnlyCount}`,
		`- runOnEdit：${presets.runOnEditCount}`,
		`- 带深度限制：${presets.depthLimitedCount}`,
	);
}

function renderRegexDetails(
	lines: string[],
	regex: RegexHealth,
	includeTags: boolean,
): void {
	lines.push("| 分类 | 脚本数 | 启用的脚本 | 可升级 |");
	lines.push("|---|---|---|---|");
	for (const item of regex.categories) {
		lines.push(
			`| ${REGEX_CATEGORY_LABELS[item.category]} | ${item.scriptCount} | ${item.enabledScriptCount} | ${item.upgradableScriptCount} |`,
		);
	}
	lines.push(
		`| 合计 | ${regex.scriptCount} | ${regex.enabledScriptCount} | ${regex.upgradableScriptCount} |`,
	);
	lines.push("");
	lines.push(
		`启用的脚本里可升级比例：${formatPercent(ratio(regex.upgradableScriptCount, regex.enabledScriptCount))}（${regex.upgradableScriptCount}/${regex.enabledScriptCount}）`,
	);
	lines.push("");
	lines.push("删除类脚本的影响范围：");
	lines.push("");
	lines.push("| 影响范围 | 脚本数 |");
	lines.push("|---|---|");
	for (const item of regex.deleteScopes) {
		lines.push(`| ${DELETE_SCOPE_LABELS[item.scope]} | ${item.scriptCount} |`);
	}
	lines.push("");
	lines.push("升级策略：");
	lines.push("");
	lines.push("| 策略 | 脚本数 |");
	lines.push("|---|---|");
	for (const item of regex.strategies) {
		lines.push(
			`| ${BLOCK_STRATEGY_LABELS[item.strategy]} | ${item.scriptCount} |`,
		);
	}
	lines.push("");
	lines.push(`- 带深度限制：${regex.depthScopedScriptCount}`);
	lines.push(`- 含内联脚本：${regex.inlineScriptCount}`);
	lines.push(`- 流式版本：${regex.streamingScriptCount}`);
	if (includeTags) {
		lines.push("");
		lines.push("目标标签前 20：");
		lines.push("");
		lines.push("| 标签 | 脚本数 |");
		lines.push("|---|---|");
		for (const item of regex.topTags) {
			lines.push(`| ${cell(item.tag)} | ${item.scriptCount} |`);
		}
	}
}

function groupChats(
	chats: readonly ChatReportEntry[],
): readonly { corpus: StoryCorpus; chats: readonly ChatReportEntry[] }[] {
	const groups: { corpus: StoryCorpus; chats: ChatReportEntry[] }[] = [];
	for (const corpus of STORY_CORPORA) {
		const list = chats.filter((chat) => chat.corpus === corpus);
		if (list.length > 0) groups.push({ corpus, chats: list });
	}
	return groups;
}

function corpusLabel(corpus: StoryCorpus): string {
	return corpus === "legacy" ? "旧语料" : "新增语料";
}

function corpusRowLabel(corpus: StoryCorpus, index: number): string {
	return corpus === "legacy" ? `对话 ${index}` : `新增对话 ${index}`;
}

function sumChats(chats: readonly ChatReportEntry[]): HealthTotals {
	const totals = {
		chatCount: chats.length,
		messageCount: 0,
		swipeCount: 0,
		fileBytes: 0,
		headerBytes: 0,
		bodyBytes: 0,
		variablesBytes: 0,
		otherBytes: 0,
		bodyTokens: 0,
		variablesTokens: 0,
		otherTokens: 0,
		snapshotBytes: 0,
		diffBytes: 0,
		diffCount: 0,
	};
	for (const chat of chats) {
		const stats = chat.stats;
		totals.messageCount += stats.messageCount;
		totals.swipeCount += stats.swipeCount;
		totals.fileBytes += stats.fileBytes;
		totals.headerBytes += stats.headerBytes;
		totals.bodyBytes += stats.bodyBytes;
		totals.variablesBytes += stats.variablesBytes;
		totals.otherBytes += stats.otherBytes;
		totals.bodyTokens += stats.bodyTokens;
		totals.variablesTokens += stats.variablesTokens;
		totals.otherTokens += stats.otherTokens;
		totals.snapshotBytes += stats.snapshotBytes;
		totals.diffBytes += stats.diffBytes;
		totals.diffCount += stats.diffCount;
	}
	return totals;
}

function aggregateFields(
	chats: readonly ChatReportEntry[],
): readonly { field: string; bytes: number }[] {
	const totals = new Map<string, number>();
	for (const chat of chats) {
		for (const field of chat.stats.fieldBytes) {
			totals.set(field.field, (totals.get(field.field) ?? 0) + field.bytes);
		}
	}
	// 截断只发生在渲染层：先合计每个对话的全部字段，再取前 10。
	return [...totals.entries()]
		.map(([field, bytes]) => ({ field, bytes }))
		.sort((left, right) => right.bytes - left.bytes)
		.slice(0, 10);
}

function sumRole(
	chats: readonly ChatReportEntry[],
	role: "user" | "assistant" | "system",
): number {
	return chats.reduce((total, chat) => total + chat.stats.roleCounts[role], 0);
}

function meanSimilarity(stats: ChatHealth): number {
	if (stats.duplication.pairs.length === 0) return 0;
	let total = 0;
	for (const pair of stats.duplication.pairs) total += pair.similarity;
	return total / stats.duplication.pairs.length;
}

function ngramDescription(report: HealthReport): string {
	const sizes = new Set(
		report.chats.map((chat) => chat.stats.duplication.ngramSize),
	);
	return sizes.size === 1
		? `${[...sizes][0]}-gram`
		: [...sizes].map((size) => `${size}-gram`).join("、");
}

function ratio(numerator: number, denominator: number): number | null {
	return denominator === 0 ? null : numerator / denominator;
}

function formatPercent(value: number | null): string {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatDecimal(value: number): string {
	return value.toFixed(3);
}

function cell(text: string): string {
	return text.replaceAll("|", "\\|");
}
