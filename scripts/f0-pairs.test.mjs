import { describe, expect, it } from "vitest";
import {
	FAILURE_CATEGORIES,
	buildJudgeMessages,
	clipText,
	createPairCollector,
	parseJudgement,
	replaceMarkedSection,
	sampleCandidates,
} from "./f0-pairs.mjs";

function message(index, overrides = {}) {
	return {
		index,
		isUser: false,
		isSystem: false,
		text: `楼层 ${index}`,
		swipes: [{ text: `楼层 ${index}` }],
		swipeId: 0,
		...overrides,
	};
}

describe("createPairCollector", () => {
	it("拒绝相邻的那次尝试，并把之前的消息放进上下文", () => {
		const collector = createPairCollector("对话 1", {
			contextMessages: 4,
			contextChars: 100,
			replyChars: 100,
		});
		collector.push(message(0, { isUser: true, text: "开始" }));
		collector.push(message(1, { text: "第一段" }));
		collector.push(
			message(2, {
				swipes: [{ text: "旧尝试" }, { text: "保留的" }],
				swipeId: 1,
			}),
		);
		const { candidates, skipped, rerolledFloors } = collector.result();
		expect(skipped).toEqual([]);
		expect(rerolledFloors).toBe(1);
		expect(candidates).toHaveLength(1);
		const [candidate] = candidates;
		expect(candidate.id).toBe("对话 1:2");
		expect(candidate.acceptedIndex).toBe(1);
		expect(candidate.rejectedIndex).toBe(0);
		expect(candidate.acceptedNotLast).toBe(false);
		expect(candidate.acceptedText).toBe("保留的");
		expect(candidate.rejectedText).toBe("旧尝试");
		expect(candidate.context.map((entry) => entry.role)).toEqual([
			"user",
			"assistant",
		]);
		expect(candidate.context.map((entry) => entry.text)).toEqual([
			"开始",
			"第一段",
		]);
	});

	it("被接受的不是最后一条时，拒绝后一条尝试并标记切回较早版本", () => {
		const collector = createPairCollector("对话 1");
		collector.push(
			message(0, {
				swipes: [{ text: "保留的" }, { text: "之后放弃的" }, { text: "更晚的" }],
				swipeId: 0,
			}),
		);
		const { candidates } = collector.result();
		expect(candidates).toHaveLength(1);
		expect(candidates[0].acceptedNotLast).toBe(true);
		expect(candidates[0].rejectedIndex).toBe(1);
		expect(candidates[0].rejectedText).toBe("之后放弃的");
	});

	it("被接受的 swipe 文本为空时用当前显示正文", () => {
		const collector = createPairCollector("对话 1");
		collector.push(
			message(0, {
				text: "编辑后的正文",
				swipes: [{ text: "" }, { text: "旧尝试" }],
				swipeId: 0,
			}),
		);
		const { candidates, skipped } = collector.result();
		expect(skipped).toEqual([]);
		expect(candidates[0].acceptedText).toBe("编辑后的正文");
		expect(candidates[0].rejectedText).toBe("旧尝试");
	});

	it("跳过无效的 swipe_id、空正文与重复文本", () => {
		const collector = createPairCollector("对话 1");
		collector.push(
			message(0, { swipes: [{ text: "a" }, { text: "b" }], swipeId: 5 }),
		);
		collector.push(
			message(1, {
				swipes: [{ text: "" }, { text: "保留的" }],
				swipeId: 1,
			}),
		);
		collector.push(
			message(2, {
				swipes: [{ text: "一样" }, { text: "一样" }],
				swipeId: 1,
			}),
		);
		const { candidates, skipped, rerolledFloors } = collector.result();
		expect(candidates).toEqual([]);
		expect(rerolledFloors).toBe(3);
		expect(skipped.map((entry) => entry.reason)).toEqual([
			"swipe_id 越界",
			"尝试的正文为空",
			"两次回复文本相同",
		]);
	});

	it("system 楼层不进上下文，上下文按上限滑动", () => {
		const collector = createPairCollector("对话 1", {
			contextMessages: 2,
			contextChars: 100,
			replyChars: 100,
		});
		collector.push(message(0, { isSystem: true, text: "系统提示" }));
		collector.push(message(1, { isUser: true, text: "问题一" }));
		collector.push(message(2, { text: "回答一" }));
		collector.push(message(3, { isUser: true, text: "问题二" }));
		collector.push(
			message(4, { swipes: [{ text: "旧" }, { text: "新" }], swipeId: 1 }),
		);
		const { candidates } = collector.result();
		expect(candidates[0].context.map((entry) => entry.text)).toEqual([
			"回答一",
			"问题二",
		]);
	});
});

describe("sampleCandidates", () => {
	function candidates(label, floors) {
		return floors.map((floor) => ({
			id: `${label}:${floor}`,
			chatLabel: label,
			floor,
		}));
	}

	it("按对话分层，目标数小于对话容量时每个对话先取一对", () => {
		const byChat = new Map([
			["对话 10", candidates("对话 10", [0, 1, 2])],
			["对话 2", candidates("对话 2", [0, 1, 2])],
		]);
		const picked = sampleCandidates(byChat, 4, "seed");
		expect(picked).toHaveLength(4);
		expect(picked.filter((item) => item.chatLabel === "对话 2")).toHaveLength(2);
		expect(picked.filter((item) => item.chatLabel === "对话 10")).toHaveLength(2);
	});

	it("同一输入重复抽样结果一致", () => {
		const byChat = new Map([
			["对话 1", candidates("对话 1", [0, 1, 2, 3])],
			["对话 2", candidates("对话 2", [0, 1])],
		]);
		const first = sampleCandidates(byChat, 5, "seed");
		const second = sampleCandidates(byChat, 5, "seed");
		expect(first).toEqual(second);
	});

	it("目标数超过可用配对时返回全部", () => {
		const byChat = new Map([["对话 1", candidates("对话 1", [0, 1])]]);
		expect(sampleCandidates(byChat, 10, "seed")).toHaveLength(2);
	});
});

describe("buildJudgeMessages", () => {
	it("包含被放弃与被保留的回复，类别固定", () => {
		const candidate = {
			context: [{ role: "user", text: "在场的人" }],
			rejectedText: "被放弃的正文",
			acceptedText: "被保留的正文",
		};
		const [system, user] = buildJudgeMessages(candidate);
		expect(system.role).toBe("system");
		for (const category of FAILURE_CATEGORIES) {
			expect(system.content).toContain(category);
		}
		expect(user.content).toContain("被放弃的正文");
		expect(user.content).toContain("被保留的正文");
		expect(user.content).toContain("用户：在场的人");
	});
});

describe("parseJudgement", () => {
	it("解析合法输出", () => {
		const parsed = parseJudgement(
			JSON.stringify({
				primary: "重复或原地打转",
				secondary: ["不推进剧情"],
				alternative_only: false,
				confidence: 0.8,
			}),
		);
		expect(parsed).toEqual({
			primary: "重复或原地打转",
			secondary: ["不推进剧情"],
			alternativeOnly: false,
			confidence: 0.8,
		});
	});

	it("接受代码围栏与前后说明里的 JSON", () => {
		const fenced = `\`\`\`json\n{"primary":"其他","secondary":[],"alternative_only":true,"confidence":0.4}\n\`\`\``;
		expect(parseJudgement(fenced).primary).toBe("其他");
		const prose = `判断如下：{"primary":"截断","secondary":[],"alternative_only":false,"confidence":0.6} 完毕`;
		expect(parseJudgement(prose).primary).toBe("截断");
	});

	it("拒绝不合法的字段", () => {
		const base = {
			primary: "其他",
			secondary: [],
			alternative_only: false,
			confidence: 0.5,
		};
		expect(() => parseJudgement("没有 JSON")).toThrow("找不到 JSON 对象");
		expect(() =>
			parseJudgement(JSON.stringify({ ...base, primary: "未知类别" })),
		).toThrow("主因不合法");
		expect(() =>
			parseJudgement(
				JSON.stringify({ ...base, secondary: ["其他", "截断", "OOC"] }),
			),
		).toThrow("次因最多两个");
		expect(() =>
			parseJudgement(JSON.stringify({ ...base, secondary: ["其他"] })),
		).toThrow("次因不能与主因相同");
		expect(() =>
			parseJudgement(
				JSON.stringify({ ...base, secondary: ["截断", "截断"] }),
			),
		).toThrow("次因重复");
		expect(() =>
			parseJudgement(JSON.stringify({ ...base, confidence: 1.5 })),
		).toThrow("confidence");
		expect(() =>
			parseJudgement(JSON.stringify({ ...base, alternative_only: "否" })),
		).toThrow("alternative_only");
	});
});

describe("replaceMarkedSection", () => {
	const marker = "F0-T02";

	it("替换已有段落并保留其他章节", () => {
		const existing = `# 报告\n\n<!-- ${marker}:begin -->\n旧内容\n<!-- ${marker}:end -->\n\n## 之后\n`;
		const section = `<!-- ${marker}:begin -->\n新内容\n<!-- ${marker}:end -->`;
		const updated = replaceMarkedSection(existing, section, marker);
		expect(updated).toContain("新内容");
		expect(updated).not.toContain("旧内容");
		expect(updated).toContain("## 之后");
		expect(updated.startsWith("# 报告")).toBe(true);
	});

	it("没有标记时追加，空文件直接写入", () => {
		const section = `<!-- ${marker}:begin -->\n内容\n<!-- ${marker}:end -->`;
		expect(replaceMarkedSection("", section, marker)).toBe(`${section}\n`);
		expect(replaceMarkedSection("# 报告\n", section, marker)).toBe(
			`# 报告\n\n${section}\n`,
		);
	});
});

describe("clipText", () => {
	it("超长时截断并标记", () => {
		expect(clipText("abc", 3)).toBe("abc");
		expect(clipText("abcdef", 3)).toBe("abc……（后续内容已截断）");
	});
});
