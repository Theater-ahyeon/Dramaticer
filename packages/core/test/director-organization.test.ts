import { describe, expect, it } from "vitest";
import {
	DEFAULT_DIRECTOR_CONFIG,
	DEFAULT_DIRECTOR_ORGANIZATION,
	type DirectorConfig,
	type DirectorEngine,
	type DirectorMechanism,
	type StoryStore,
	assertDirectorOrganizationKind,
	createDirectorEngine,
	createDirectorSlotProvider,
	isDirectorOrganizationKind,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function seed(store: StoryStore): string {
	store.createStory({ id: "s1", title: "测试故事" });
	store.appendNode({
		id: "n0",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。",
	});
	return "n0";
}

function fixedMechanism(name: string): DirectorMechanism {
	return {
		name,
		evaluate() {
			return {
				triggered: true,
				reason: "固定触发",
				suggestion: {
					mechanism: name,
					priority: 10,
					directive: `${name} 的建议`,
					signals: {},
				},
				signals: { [name]: true },
			};
		},
	};
}

describe("导演组织方式", () => {
	it("默认沿用现有机制序列，非法种类抛错并指出标签", () => {
		expect(DEFAULT_DIRECTOR_ORGANIZATION).toBe("mechanisms");
		expect(isDirectorOrganizationKind("mechanisms")).toBe(true);
		expect(isDirectorOrganizationKind("bits")).toBe(true);
		expect(isDirectorOrganizationKind("scripts")).toBe(false);
		expect(assertDirectorOrganizationKind("bits")).toBe("bits");
		expect(() => assertDirectorOrganizationKind("scripts")).toThrow(
			"导演的组织方式不合法：scripts",
		);
		expect(() =>
			assertDirectorOrganizationKind(
				"scripts",
				"故事设置的 directorOrganization",
			),
		).toThrow("故事设置的 directorOrganization不合法：scripts");
	});

	it("机制型引擎评估注入的机制并写入决策记录", () => {
		const { store } = openTempStore();
		const nodeId = seed(store);
		const engine = createDirectorEngine("mechanisms", {
			mechanisms: [fixedMechanism("custom")],
		});
		expect(engine.kind).toBe("mechanisms");
		expect(engine.mechanismNames).toEqual(["custom"]);

		const suggestion = engine.evaluate({
			store,
			storyId: "s1",
			nodeId,
			config: DEFAULT_DIRECTOR_CONFIG,
		});
		expect(suggestion?.mechanism).toBe("custom");
		expect(suggestion?.directive).toBe("custom 的建议");
		expect(store.getDirectorDecision(nodeId)?.mechanisms).toEqual([
			{ name: "custom", triggered: true, reason: "固定触发" },
		]);
	});

	it("导演关闭时引擎返回 null 且不写决策记录", () => {
		const { store } = openTempStore();
		const nodeId = seed(store);
		const engine = createDirectorEngine("mechanisms", {
			mechanisms: [fixedMechanism("custom")],
		});
		const config: DirectorConfig = { ...DEFAULT_DIRECTOR_CONFIG, mode: "off" };
		expect(
			engine.evaluate({ store, storyId: "s1", nodeId, config }),
		).toBeNull();
		expect(store.getDirectorDecision(nodeId)).toBeNull();
	});

	it("剧情小品引擎尚未实现时直接失败", () => {
		expect(() => createDirectorEngine("bits")).toThrow(
			"导演组织方式 bits 尚未实现（X2.b）",
		);
	});

	it("槽位按组织方式选择引擎，上下文包指纹带上种类", async () => {
		const { store } = openTempStore();
		const nodeId = seed(store);
		const engine: DirectorEngine = {
			kind: "bits",
			mechanismNames: null,
			evaluate() {
				return null;
			},
		};
		const provider = createDirectorSlotProvider(store, { engine });
		expect(provider.engine).toBe(engine);
		expect(String(provider.packKey)).toContain('"organization":"bits"');
		expect(
			await provider.provide({
				slot: "director",
				storyId: "s1",
				nodeId,
				switches: {},
				state: undefined,
			}),
		).toBeNull();
	});

	it("机制型槽位与直接评估产出的建议相同", async () => {
		const { store } = openTempStore();
		const nodeId = seed(store);
		const provider = createDirectorSlotProvider(store, {
			mechanisms: [fixedMechanism("custom")],
		});
		expect(provider.engine.kind).toBe("mechanisms");
		const content = await provider.provide({
			slot: "director",
			storyId: "s1",
			nodeId,
			switches: {},
			state: undefined,
		});
		expect(content?.source).toBe("director:custom");
		expect(content?.suffix).toContain("【导演】custom 的建议");
	});
});
