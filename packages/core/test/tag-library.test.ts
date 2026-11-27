import { describe, expect, it } from "vitest";
import {
	type TagLibraryEntryInput,
	groupTagLibraryEntries,
	matchTagLibraryEntries,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function tag(
	patch: Partial<TagLibraryEntryInput> & { name: string },
): TagLibraryEntryInput {
	return {
		id: `tag-${patch.name}`,
		category: "action",
		content: `内容-${patch.name}`,
		keywords: [],
		...patch,
	};
}

describe("标签库存储与触发", () => {
	it("按故事保存、读取、开关与删除；全局条目不属于替换范围", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "故事一" });
		store.createStory({ id: "s2", title: "故事二" });
		store.replaceTagLibraryEntries({
			storyId: "s1",
			entries: [
				tag({ name: "拔剑", category: "action", keywords: ["拔剑"] }),
				tag({ name: "夜景", category: "scene", constant: true }),
			],
		});
		store.upsertTagLibraryEntry({
			storyId: null,
			scope: "global",
			category: "style",
			name: "全局画风",
			content: "清晰线条",
		});
		const listed = store.listTagLibraryEntries("s1");
		expect(listed.map((entry) => entry.name)).toEqual([
			"拔剑",
			"夜景",
			"全局画风",
		]);
		expect(listed.find((entry) => entry.name === "全局画风")?.scope).toBe(
			"global",
		);
		store.replaceTagLibraryEntries({
			storyId: "s1",
			entries: [
				tag({
					name: "拔剑",
					category: "action",
					keywords: ["拔剑"],
					enabled: false,
				}),
			],
		});
		const after = store.listTagLibraryEntries("s1");
		expect(after.map((entry) => entry.name)).toEqual(["拔剑", "全局画风"]);
		expect(after.find((entry) => entry.name === "拔剑")?.enabled).toBe(false);
		expect(store.listTagLibraryEntries("s2")).toHaveLength(1);
	});

	it("关键词大小写无关，常驻条目总命中，停用条目不命中", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "触发" });
		const entries = store.replaceTagLibraryEntries({
			storyId: "s1",
			entries: [
				tag({ name: "拔剑", category: "action", keywords: ["拔剑", "Sword"] }),
				tag({ name: "常驻构图", category: "composition", constant: true }),
				tag({
					name: "停用",
					category: "expression",
					keywords: ["笑"],
					enabled: false,
				}),
				tag({ name: "无关", category: "pose", keywords: ["跳"] }),
			],
		});
		expect(entries.map((entry) => entry.name)).toEqual([
			"拔剑",
			"无关",
			"常驻构图",
			"停用",
		]);
		const matches = matchTagLibraryEntries(
			entries,
			"她拔剑，轻轻笑了一下，sword 在月光下。",
		);
		expect(matches.map((entry) => entry.name)).toEqual(["拔剑", "常驻构图"]);
		const grouped = groupTagLibraryEntries(matches);
		expect(grouped.map((group) => group.category)).toEqual([
			"action",
			"composition",
		]);
		expect(matchTagLibraryEntries(entries, "什么也没发生")).toHaveLength(1);
	});

	it("优先级高的排在分类内前面", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "排序" });
		const entries = store.replaceTagLibraryEntries({
			storyId: "s1",
			entries: [
				tag({ name: "低", category: "action", constant: true, priority: 1 }),
				tag({ name: "高", category: "action", constant: true, priority: 9 }),
			],
		});
		expect(entries.map((entry) => entry.name)).toEqual(["高", "低"]);
	});
});

describe("独立服装存储", () => {
	it("整体替换、同名更新与默认服装唯一", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "服装" });
		const saved = store.replaceCharacterOutfits({
			storyId: "s1",
			outfits: [
				{
					id: "o1",
					character: "凛",
					name: "校服",
					upperVisible: ["shirt"],
					isDefault: true,
				},
				{
					id: "o2",
					character: "凛",
					name: "礼服",
					fullVisible: ["dress"],
				},
			],
		});
		expect(saved).toHaveLength(2);
		expect(saved.find((outfit) => outfit.name === "校服")?.isDefault).toBe(
			true,
		);
		expect(() =>
			store.replaceCharacterOutfits({
				storyId: "s1",
				outfits: [
					{ character: "凛", name: "A", isDefault: true },
					{ character: "凛", name: "B", isDefault: true },
				],
			}),
		).toThrow("默认服装");
		const updated = store.upsertCharacterOutfit({
			storyId: "s1",
			character: "凛",
			name: "校服",
			upperVisible: ["jacket"],
			isDefault: true,
		});
		expect(updated.id).toBe("o1");
		expect(updated.upperVisible).toEqual(["jacket"]);
		const remaining = store
			.listCharacterOutfits("s1")
			.find((outfit) => outfit.name === "礼服");
		expect(remaining).toBeDefined();
		store.deleteCharacterOutfit("o2");
		expect(store.listCharacterOutfits("s1")).toHaveLength(1);
	});
});
