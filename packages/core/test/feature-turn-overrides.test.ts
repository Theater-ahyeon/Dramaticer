import { describe, expect, it } from "vitest";
import {
	type ContextSlotRequest,
	type FeatureSwitchOverrides,
	type NewImportAuditEntry,
	type StoryStore,
	contextPackFingerprint,
	createLoreSlotProvider,
	resolveLoreInjectionRole,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

// refactor/02：「写作指令层」接通文风类设定条目；本轮临时开关叠在功能页设置上。

function request(
	featureOverrides?: FeatureSwitchOverrides,
): ContextSlotRequest {
	return {
		slot: "lore",
		storyId: "styled",
		nodeId: "st1",
		switches: {},
		state: undefined,
		...(featureOverrides === undefined ? {} : { featureOverrides }),
	};
}

function seedStyledLore(store: StoryStore): void {
	store.createStory({ id: "styled", title: "文风故事" });
	store.appendNode({
		id: "st1",
		storyId: "styled",
		parentId: null,
		role: "user",
		raw: "我推开门。",
	});
	store.insertLoreEntries([
		{
			id: "l-common",
			storyId: "styled",
			name: "世界观",
			content: "雾港常年起雾。",
			constant: true,
			source: "world-info:书:0",
		},
		{
			id: "l-writing",
			storyId: "styled",
			name: "文风",
			content: "用第二人称，短句为主。",
			constant: true,
			source: "world-info:书:1",
		},
	]);
	const audit = (
		source: string,
		title: string,
		kind: NewImportAuditEntry["rulePrimary"],
	): NewImportAuditEntry => ({
		source,
		title,
		content: "分型审计正文",
		matches: [{ kind, rules: ["test"] }],
		rulePrimary: kind,
		constant: true,
	});
	store.saveImportAuditEntries("styled", [
		audit("world-info:书:0", "世界观", "common"),
		audit("world-info:书:1", "文风", "writing"),
	]);
}

describe("写作指令层开关", () => {
	it("开着时文风条目每轮常驻并标成【文风】，关着时不注入", async () => {
		const { store } = openTempStore();
		seedStyledLore(store);
		const provider = createLoreSlotProvider(store);

		const on = await provider.provide(request());
		expect(on?.messages[0]?.content).toContain(
			"【文风】文风：用第二人称，短句为主。",
		);

		store.updateStorySettings("styled", { featureSwitches: { style: false } });
		const off = await provider.provide(request());
		expect(off?.messages[0]?.content).toContain("【常识】世界观");
		expect(off?.messages[0]?.content).not.toContain("第二人称");
	});

	it("注入方式只由开关决定，原样模式仍按常驻标记", () => {
		const entry = {
			id: "l",
			storyId: "s",
			name: "文风",
			content: "",
			keywords: [],
			constant: true,
			entityId: null,
			source: "x",
		} as unknown as Parameters<typeof resolveLoreInjectionRole>[0];
		const rule = { source: "x", kind: "writing", memory: false } as Parameters<
			typeof resolveLoreInjectionRole
		>[2];
		expect(
			resolveLoreInjectionRole(entry, "upgrade", rule, { style: true }),
		).toEqual({ base: "full", matched: false });
		expect(resolveLoreInjectionRole(entry, "upgrade", rule)).toEqual({
			base: null,
			matched: false,
		});
		expect(resolveLoreInjectionRole(entry, "raw", rule)).toEqual({
			base: "full",
			matched: false,
		});
	});
});

describe("本轮临时开关", () => {
	it("只影响这一轮：临时关掉文风，故事设置不变", async () => {
		const { store } = openTempStore();
		seedStyledLore(store);
		const provider = createLoreSlotProvider(store);

		const once = await provider.provide(request({ style: false }));
		expect(once?.messages[0]?.content).not.toContain("第二人称");
		expect(store.getStorySettings("styled").featureSwitches.style).toBe(
			undefined,
		);
		const next = await provider.provide(request());
		expect(next?.messages[0]?.content).toContain("第二人称");
	});

	it("故事里关着的开关可以只在这一轮打开", async () => {
		const { store } = openTempStore();
		seedStyledLore(store);
		store.updateStorySettings("styled", { featureSwitches: { style: false } });
		const provider = createLoreSlotProvider(store);
		const once = await provider.provide(request({ style: true }));
		expect(once?.messages[0]?.content).toContain("【文风】");
	});

	it("不同的临时开关不复用同一个上下文包", () => {
		const base = {
			template: { id: "t", segments: [] } as never,
			budgetTokens: 1000,
			profile: "native" as const,
			directorIntensity: null,
			providers: undefined,
		};
		const plain = contextPackFingerprint(base);
		expect(contextPackFingerprint({ ...base, featureOverrides: {} })).toBe(
			plain,
		);
		expect(contextPackFingerprint({ ...base, featureOverrides: null })).toBe(
			plain,
		);
		const off = contextPackFingerprint({
			...base,
			featureOverrides: { style: false },
		});
		expect(off).not.toBe(plain);
		expect(
			contextPackFingerprint({ ...base, featureOverrides: { style: true } }),
		).not.toBe(off);
	});
});
