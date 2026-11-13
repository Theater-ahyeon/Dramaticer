import {
	type ContextSlotProvider,
	type ContextSlotRequest,
	StoryStore,
} from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { parseCharacterCardJson } from "../src/character-card.js";
import type { JsonObject } from "../src/index.js";
import { type StRegexScript, parsePresetJson } from "../src/preset.js";
import { readStAuthorNote } from "../src/st-content/author-note.js";
import { createStMacroEngine } from "../src/st-content/macros.js";
import { readStPersona } from "../src/st-content/persona.js";
import { mapStPreset } from "../src/st-content/preset-mapping.js";
import {
	ST_REGEX_PLACEMENT,
	ST_SUBSTITUTE_REGEX,
	applyStRegexScripts,
	collectStRegexScripts,
	parseStRegexScript,
} from "../src/st-content/regex.js";
import {
	ST_WORLD_INFO_POSITION,
	activateStWorldInfo,
	createStWorldInfoProviders,
} from "../src/st-content/world-info-activation.js";
import { parseWorldInfoJson } from "../src/world-info.js";

const FIXED_NOW = new Date(2026, 10, 13, 15, 4, 0);

function regexScript(overrides: JsonObject = {}) {
	const script = parseStRegexScript({
		id: "script-1",
		scriptName: "测试脚本",
		findRegex: "/a/g",
		replaceString: "b",
		trimStrings: [],
		placement: [ST_REGEX_PLACEMENT.aiOutput],
		disabled: false,
		markdownOnly: false,
		promptOnly: false,
		runOnEdit: false,
		substituteRegex: ST_SUBSTITUTE_REGEX.none,
		minDepth: null,
		maxDepth: null,
		...overrides,
	});
	if (script === null) throw new Error("测试正则脚本解析失败");
	return script;
}

describe("酒馆宏引擎", () => {
	it("替换角色卡、用户与群聊环境宏，并按酒馆的顺序让值里的宏继续展开", () => {
		const engine = createStMacroEngine({
			user: "玩家",
			char: "艾莉丝",
			group: "艾莉丝, 鲍勃",
			groupNotMuted: "艾莉丝",
			notChar: "鲍勃, 玩家",
			card: {
				description: "{{user}} 的旧识",
				personality: "冷静",
				scenario: "港口",
				persona: "人设",
				charPrompt: "系统提示",
				charJailbreak: "越狱提示",
				charDepthPrompt: "深度提示",
				creatorNotes: "作者注释",
				charVersion: "1.2",
			},
		});
		expect(
			engine.substitute(
				"{{user}} 与 {{char}} 在 {{scenario}}；<GROUP>|<CHAR>|<USER>|{{notChar}}|{{groupNotMuted}}",
			),
		).toBe(
			"玩家 与 艾莉丝 在 港口；艾莉丝, 鲍勃|艾莉丝|玩家|鲍勃, 玩家|艾莉丝",
		);
		expect(
			engine.substitute(
				"{{description}}|{{personality}}|{{persona}}|{{charPrompt}}|{{charJailbreak}}|{{charDepthPrompt}}|{{creatorNotes}}|{{charVersion}}",
			),
		).toBe("玩家 的旧识|冷静|人设|系统提示|越狱提示|深度提示|作者注释|1.2");
	});

	it("读写局部与全局变量，数值按酒馆的方式重新计算", () => {
		const engine = createStMacroEngine();
		expect(engine.substitute("{{setvar::hp::10}}{{getvar::hp}}")).toBe("10");
		expect(engine.substitute("{{incvar::hp}}")).toBe("11");
		expect(engine.substitute("{{getvar::hp}}")).toBe("11");
		expect(engine.substitute("{{addvar::hp::5}}")).toBe("16");
		expect(engine.substitute("{{getvar::hp}}")).toBe("16");
		expect(engine.substitute("{{decvar::hp}}")).toBe("15");
		expect(
			engine.substitute("{{setglobalvar::gold::7}}{{getglobalvar::gold}}"),
		).toBe("7");
		expect(engine.substitute("{{getvar::gold}}")).toBe("");
		expect(engine.variables.local.hp).toBe(15);
		expect(engine.variables.global.gold).toBe("7");
	});

	it("随机与稳定抽取使用注入的随机源", () => {
		const first = createStMacroEngine({
			random: () => 0,
			chatId: "chat-1",
		});
		const second = createStMacroEngine({
			random: () => 0.99,
			chatId: "chat-1",
		});
		expect(first.substitute("{{random::甲::乙}}")).toBe("甲");
		expect(second.substitute("{{random::甲::乙}}")).toBe("乙");
		const text = "{{pick::甲::乙::丙}}";
		const picked = first.substitute(text);
		expect(["甲", "乙", "丙"]).toContain(picked);
		expect(first.substitute(text)).toBe(picked);
		expect(
			createStMacroEngine({ chatId: "chat-1", random: () => 0.99 }).substitute(
				text,
			),
		).toBe(picked);
	});

	it("骰子宏接受骰子公式，非法公式替换为空", () => {
		const engine = createStMacroEngine();
		expect(engine.substitute("{{roll:1d1}}")).toBe("1");
		const rolled = Number(engine.substitute("{{roll:3}}"));
		expect(rolled).toBeGreaterThanOrEqual(1);
		expect(rolled).toBeLessThanOrEqual(3);
		expect(engine.substitute("x{{roll:abc}}y")).toBe("xy");
	});

	it("对话宏读取最后一条、玩家与角色消息", () => {
		const engine = createStMacroEngine({
			messages: [
				{ text: "第一楼", isUser: false },
				{ text: "你好", isUser: true },
				{ text: "欢迎", isUser: false },
			],
		});
		expect(
			engine.substitute(
				"{{lastMessage}}|{{lastUserMessage}}|{{lastCharMessage}}|{{lastMessageId}}|{{allChatRange}}",
			),
		).toBe("欢迎|你好|欢迎|2|0-2");
		const swiped = createStMacroEngine({
			messages: [
				{
					text: "候选",
					isUser: false,
					swipes: ["候选", "另一条"],
					swipeId: 1,
				},
			],
		});
		expect(swiped.substitute("{{lastSwipeId}}|{{currentSwipeId}}")).toBe("2|2");
	});

	it("时间宏按固定时钟输出，与酒馆的 moment 格式一致", () => {
		const engine = createStMacroEngine({ now: () => FIXED_NOW });
		expect(
			engine.substitute(
				"{{time}}|{{date}}|{{weekday}}|{{isotime}}|{{isodate}}|{{datetimeformat YYYY/MM/DD}}",
			),
		).toBe("3:04 PM|November 13, 2026|Friday|15:04|2026-11-13|2026/11/13");
		expect(engine.substitute("{{timeDiff::2026-11-15::2026-11-13}}")).toBe(
			"in 2 days",
		);
	});

	it("工具宏处理换行、裁剪、注释、反转、输入、outlet 与屏蔽词", () => {
		const engine = createStMacroEngine({
			input: "输入内容",
			outlets: { 旁白: "旁白内容" },
		});
		expect(engine.substitute("A{{newline}}B")).toBe("A\nB");
		expect(engine.substitute("A\n{{trim}}\nB")).toBe("AB");
		expect(engine.substitute("A{{noop}}B")).toBe("AB");
		expect(engine.substitute("A{{// 注释 }}B")).toBe("AB");
		expect(engine.substitute("{{reverse:abc}}")).toBe("cba");
		expect(engine.substitute("{{input}}|{{outlet::旁白}}")).toBe(
			"输入内容|旁白内容",
		);
		expect(engine.substitute('x{{banned "坏词"}}y')).toBe("xy");
	});

	it("空闲时长根据最后一条玩家消息计算", () => {
		const engine = createStMacroEngine({
			now: () => new Date(2026, 10, 13, 12, 0, 0),
			messages: [
				{
					text: "在吗",
					isUser: true,
					sendDate: new Date(2026, 10, 13, 10, 0, 0),
				},
				{ text: "在", isUser: false },
			],
		});
		expect(engine.substitute("{{idle_duration}}")).toBe("2 hours");
	});

	it("原句只替换一次，未识别的宏保留并列出", () => {
		const engine = createStMacroEngine({ original: "原句" });
		expect(engine.substitute("{{original}}/{{original}}")).toBe("原句/");
		const text = "{{char}} 与 {{未知宏::参数}}";
		const charEngine = createStMacroEngine({ char: "艾莉丝" });
		const substituted = charEngine.substitute(text);
		expect(substituted).toBe("艾莉丝 与 {{未知宏::参数}}");
		expect(charEngine.unresolved(substituted)).toEqual(["未知宏::参数"]);
	});

	it("后处理函数逐个作用于替换值", () => {
		const engine = createStMacroEngine({ user: "A.B" });
		expect(
			engine.substitute("{{user}}", {
				postProcess: (value) => value.replaceAll(".", "\\."),
			}),
		).toBe("A\\.B");
	});
});

describe("酒馆正则引擎", () => {
	function apply(
		script: StRegexScript,
		text: string,
		options: {
			readonly isMarkdown?: boolean;
			readonly isPrompt?: boolean;
			readonly isEdit?: boolean;
			readonly depth?: number;
			readonly characterName?: string;
		} = {},
	) {
		return applyStRegexScripts(text, ST_REGEX_PLACEMENT.aiOutput, {
			scripts: [script],
			...options,
		});
	}

	it("按作用位置筛选脚本", () => {
		const script = regexScript({
			placement: [ST_REGEX_PLACEMENT.worldInfo],
			promptOnly: true,
		});
		expect(
			applyStRegexScripts("a", ST_REGEX_PLACEMENT.aiOutput, {
				scripts: [script],
			}),
		).toBe("a");
		expect(
			applyStRegexScripts("a", ST_REGEX_PLACEMENT.worldInfo, {
				scripts: [script],
				isPrompt: true,
			}),
		).toBe("b");
	});

	it("只影响显示、只影响 prompt 与两处都不设的脚本互斥执行", () => {
		const plain = regexScript();
		expect(apply(plain, "a", { isMarkdown: true })).toBe("a");
		expect(apply(plain, "a", { isPrompt: true })).toBe("a");
		expect(apply(plain, "a")).toBe("b");
		const markdownOnly = regexScript({ markdownOnly: true });
		expect(apply(markdownOnly, "a", { isMarkdown: true })).toBe("b");
		expect(apply(markdownOnly, "a", { isPrompt: true })).toBe("a");
		const promptOnly = regexScript({ promptOnly: true });
		expect(apply(promptOnly, "a", { isPrompt: true })).toBe("b");
		expect(apply(promptOnly, "a", { isMarkdown: true })).toBe("a");
	});

	it("关闭的脚本不执行，编辑时只执行允许编辑的脚本", () => {
		expect(apply(regexScript({ disabled: true }), "a")).toBe("a");
		expect(apply(regexScript(), "a", { isEdit: true })).toBe("a");
		expect(apply(regexScript({ runOnEdit: true }), "a", { isEdit: true })).toBe(
			"b",
		);
	});

	it("深度范围按最小与最大深度筛选", () => {
		const minDepth = regexScript({ minDepth: 2 });
		expect(apply(minDepth, "a", { depth: 1 })).toBe("a");
		expect(apply(minDepth, "a", { depth: 2 })).toBe("b");
		const maxDepth = regexScript({ maxDepth: 1 });
		expect(apply(maxDepth, "a", { depth: 2 })).toBe("a");
		expect(apply(maxDepth, "a", { depth: 1 })).toBe("b");
		expect(apply(regexScript({ minDepth: -1 }), "a", { depth: 0 })).toBe("b");
		expect(apply(regexScript({ maxDepth: -1 }), "a", { depth: 99 })).toBe("b");
	});

	it("替换串支持编号组、命名组、{{match}} 与 trimStrings", () => {
		expect(
			apply(
				regexScript({
					findRegex: "/(ab)(cd)/",
					replaceString: "$2$1",
				}),
				"abcd",
			),
		).toBe("cdab");
		expect(
			apply(
				regexScript({
					findRegex: "/(?<left>a)(?<right>b)/",
					replaceString: "$<right>$<left>",
				}),
				"ab",
			),
		).toBe("ba");
		expect(
			apply(
				regexScript({
					findRegex: "/(a)/",
					replaceString: "{{match}}{{match}}",
				}),
				"a",
			),
		).toBe("aa");
		expect(
			apply(
				regexScript({
					findRegex: "/\\[(.*?)\\]/",
					replaceString: "$1",
					trimStrings: ["{{char}}"],
				}),
				"[艾莉丝]",
				{ characterName: "艾莉丝" },
			),
		).toBe("");
	});

	it("替换串与 findRegex 里的宏按 substituteRegex 处理", () => {
		const engine = createStMacroEngine({ char: "A.B" });
		const raw = regexScript({
			findRegex: "{{char}}",
			replaceString: "命中",
			substituteRegex: ST_SUBSTITUTE_REGEX.raw,
		});
		const escaped = regexScript({
			findRegex: "{{char}}",
			replaceString: "命中",
			substituteRegex: ST_SUBSTITUTE_REGEX.escaped,
		});
		expect(
			applyStRegexScripts("AxB", ST_REGEX_PLACEMENT.aiOutput, {
				scripts: [raw],
				substitute: engine.substitute,
			}),
		).toBe("命中");
		expect(
			applyStRegexScripts("AxB", ST_REGEX_PLACEMENT.aiOutput, {
				scripts: [escaped],
				substitute: engine.substitute,
			}),
		).toBe("AxB");
		expect(
			applyStRegexScripts("A.B", ST_REGEX_PLACEMENT.aiOutput, {
				scripts: [escaped],
				substitute: engine.substitute,
			}),
		).toBe("命中");
	});

	it("非法正则与空输入保持原样", () => {
		expect(apply(regexScript({ findRegex: "/[/" }), "a")).toBe("a");
		expect(apply(regexScript(), "")).toBe("");
	});

	it("按全局、角色卡、预设的顺序收集，未允许的来源跳过", () => {
		const global = [{ ...regexScript({ scriptName: "全局" }), raw: {} }];
		const scoped = [{ ...regexScript({ scriptName: "角色卡" }), raw: {} }];
		const preset = [{ ...regexScript({ scriptName: "预设" }), raw: {} }];
		expect(
			collectStRegexScripts({ global, scoped, preset }).map(
				(script) => script.scriptName,
			),
		).toEqual(["全局"]);
		expect(
			collectStRegexScripts({
				global,
				scoped,
				preset,
				allowScoped: true,
				allowPreset: true,
			}).map((script) => script.scriptName),
		).toEqual(["全局", "角色卡", "预设"]);
	});
});

const card = parseCharacterCardJson(
	JSON.stringify({
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name: "艾莉丝",
			description: "角色描述 {{user}}",
			personality: "性格正文",
			scenario: "场景正文",
			mes_example: "示例正文",
			system_prompt: "卡片系统提示",
			post_history_instructions: "卡片历史后指令",
		},
	}),
);

function presetPrompt(
	identifier: string,
	overrides: JsonObject = {},
): JsonObject {
	return {
		identifier,
		name: identifier,
		content: "",
		role: "system",
		system_prompt: true,
		marker: false,
		enabled: true,
		injection_position: 0,
		...overrides,
	};
}

function preset(raw: JsonObject) {
	return parsePresetJson(JSON.stringify(raw));
}

describe("宏与正则接入 st-content", () => {
	it("预设、卡片 marker、人设注入与作者注释都做宏替换", () => {
		const parsed = preset({
			prompts: [
				promptWithContent("main", "你是 {{char}}，面对 {{user}}。", {
					forbid_overrides: true,
				}),
				promptWithContent("charDescription", "", { marker: true }),
				promptWithContent("personaDescription", "", { marker: true }),
				promptWithContent("chatHistory", "", { marker: true }),
			],
			prompt_order: [
				{
					character_id: 100001,
					order: [
						"main",
						"charDescription",
						"personaDescription",
						"chatHistory",
					].map((identifier) => ({ identifier, enabled: true })),
				},
			],
		});
		const persona = readStPersona({
			user_avatar: "me.png",
			power_user: {
				personas: { "me.png": "玩家" },
				persona_descriptions: {
					"me.png": { description: "{{user}} 的人设", position: 4, depth: 2 },
				},
			},
		});
		if (persona === null) throw new Error("测试人设缺失");
		const authorNote = readStAuthorNote({
			note_prompt: "{{char}} 记得 {{user}}",
			note_interval: 1,
			note_position: 1,
			note_depth: 2,
			note_role: 0,
		});
		if (authorNote === null) throw new Error("测试作者注释缺失");
		const macros = createStMacroEngine({ user: "玩家", char: "艾莉丝" });
		const mapping = mapStPreset({
			preset: parsed,
			card,
			structuredOutput: "text-tags",
			persona,
			authorNote,
			macros,
		});
		const staticSegments = mapping.template.segments.filter(
			(segment) => segment.kind === "static",
		);
		expect(
			staticSegments
				.map((segment) => segment.text)
				.filter((text) => text.length > 0 && !text.includes("写作契约")),
		).toEqual(["你是 艾莉丝，面对 玩家。", "角色描述 玩家"]);
		expect(mapping.injections.map((injection) => injection.content)).toEqual([
			"玩家 的人设",
			"艾莉丝 记得 玩家",
		]);
		expect(mapping.issues).toEqual([]);
	});

	it("未识别的宏保留在正文里并记入报告", () => {
		const parsed = preset({
			prompts: [
				promptWithContent("main", "保留 {{未知宏}}", {
					forbid_overrides: true,
				}),
			],
			prompt_order: [
				{
					character_id: 100001,
					order: [{ identifier: "main", enabled: true }],
				},
			],
		});
		const mapping = mapStPreset({
			preset: parsed,
			card,
			structuredOutput: "text-tags",
			macros: createStMacroEngine(),
		});
		expect(mapping.template.segments[0]).toMatchObject({
			kind: "static",
			text: "保留 {{未知宏}}",
		});
		expect(mapping.issues).toEqual([{ code: "macro", detail: "main" }]);
	});

	it("世界书条目的关键词与正文都做宏替换，递归缓冲使用替换后的正文", () => {
		const macros = createStMacroEngine({ char: "艾莉丝", user: "玩家" });
		const world = parseWorldInfoJson(
			JSON.stringify({
				entries: {
					"1": {
						uid: 1,
						key: ["{{char}}"],
						content: "{{char}} 是 {{user}} 的同伴",
						disable: false,
						selective: true,
						position: ST_WORLD_INFO_POSITION.before,
					},
					"2": {
						uid: 2,
						key: ["同伴"],
						content: "第二条",
						disable: false,
						selective: true,
						position: ST_WORLD_INFO_POSITION.before,
					},
				},
			}),
		);
		const activation = activateStWorldInfo({
			worlds: [{ ...world, name: "宏世界" }],
			messages: ["艾莉丝出现了"],
			chatLength: 1,
			settings: { recursive: true },
			substitute: macros.substitute,
		});
		expect(activation.before).toEqual(["第二条", "艾莉丝 是 玩家 的同伴"]);
	});
});

function promptWithContent(
	identifier: string,
	content: string,
	overrides: JsonObject = {},
): JsonObject {
	return {
		identifier,
		name: identifier,
		content,
		role: "system",
		system_prompt: true,
		marker: false,
		enabled: true,
		injection_position: 0,
		...overrides,
	};
}

describe("世界书 prompt 正则", () => {
	function worldEntry(
		uid: number,
		keys: readonly string[],
		content: string,
		overrides: JsonObject = {},
	): JsonObject {
		return {
			uid,
			key: keys,
			keysecondary: [],
			content,
			constant: false,
			disable: false,
			selective: true,
			useProbability: true,
			position: ST_WORLD_INFO_POSITION.before,
			...overrides,
		};
	}

	function world(entries: readonly JsonObject[]) {
		const raw: JsonObject = {};
		entries.forEach((item, index) => {
			raw[String(item.uid ?? index)] = item;
		});
		const parsed = parseWorldInfoJson(JSON.stringify({ entries: raw }));
		return { ...parsed, name: "正则世界" };
	}

	function openStore(): StoryStore {
		const store = StoryStore.open(":memory:");
		store.createStory({ id: "story-1", title: "测试故事" });
		onTestFinished(() => store.close());
		store.appendNode({
			id: "n-1",
			storyId: "story-1",
			parentId: null,
			role: "user",
			raw: "旧名出现",
		});
		return store;
	}

	function request(nodeId: string | null): ContextSlotRequest {
		return {
			slot: "lore",
			storyId: "story-1",
			nodeId,
			switches: {},
			state: null,
		};
	}

	it("promptOnly 的 WORLD_INFO 脚本在槽位里执行，markdownOnly 的不执行", async () => {
		const store = openStore();
		const promptScript = regexScript({
			findRegex: "/旧名/g",
			replaceString: "新名",
			promptOnly: true,
			placement: [ST_REGEX_PLACEMENT.worldInfo],
		});
		const markdownScript = regexScript({
			findRegex: "/新名/g",
			replaceString: "显示名",
			markdownOnly: true,
			placement: [ST_REGEX_PLACEMENT.worldInfo],
		});
		const providers = createStWorldInfoProviders({
			worlds: [world([worldEntry(1, ["旧名"], "旧名 出现")])],
			store,
			regexScripts: [promptScript, markdownScript],
		});
		const content = await providers.lore.provide(request("n-1"));
		expect(content?.messages).toEqual([
			{ role: "system", content: "新名 出现" },
		]);
		expect((await providers.activate(request("n-1"))).before).toEqual([
			"新名 出现",
		]);
	});

	it("深度条目的正则按条目深度筛选", async () => {
		const store = openStore();
		const shallow = regexScript({
			findRegex: "/旧名/g",
			replaceString: "浅层",
			promptOnly: true,
			placement: [ST_REGEX_PLACEMENT.worldInfo],
			maxDepth: 1,
		});
		const deep = regexScript({
			id: "script-2",
			findRegex: "/旧名/g",
			replaceString: "深层",
			promptOnly: true,
			placement: [ST_REGEX_PLACEMENT.worldInfo],
			minDepth: 2,
		});
		const providers = createStWorldInfoProviders({
			worlds: [
				world([
					worldEntry(1, ["旧名"], "旧名", {
						position: ST_WORLD_INFO_POSITION.atDepth,
						depth: 2,
						role: 0,
					}),
				]),
			],
			store,
			regexScripts: [shallow, deep],
		});
		const activation = await providers.activate(request("n-1"));
		expect(activation.depth).toEqual([
			{ depth: 2, role: "system", contents: ["深层"] },
		]);
		const base: ContextSlotProvider = {
			provide: () => ({ messages: [], source: "history:0" }),
		};
		const wrapped = await providers.wrapHistory(base).provide(request("n-1"));
		expect(wrapped?.messages).toEqual([{ role: "system", content: "深层" }]);
	});
});
