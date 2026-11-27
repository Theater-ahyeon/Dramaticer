import { describe, expect, it } from "vitest";
import {
	type CharacterOutfit,
	type CharacterVisualProfile,
	VISUAL_DRESS_STATES,
	VISUAL_SLOT_PARTS,
	VISUAL_SLOT_VIEWS,
	assertCharacterVisualProfile,
	expandVisualProfile,
	normalizeCharacterOutfit,
	selectCharacterOutfit,
} from "../src/index.js";

function slotGrid(): Record<string, Record<string, Record<string, string[]>>> {
	const grid: Record<string, Record<string, Record<string, string[]>>> = {};
	for (const part of VISUAL_SLOT_PARTS) {
		grid[part] = {};
		for (const view of VISUAL_SLOT_VIEWS) {
			grid[part][view] = {
				clothed: [`${part}-${view}-clothed`],
				bare: [`${part}-${view}-bare`],
			};
		}
	}
	return grid;
}

function profile(): CharacterVisualProfile {
	return assertCharacterVisualProfile({
		character: "凛",
		base: ["base"],
		defaultOutfit: "校服",
		slots: slotGrid(),
	});
}

function outfit(patch: Partial<CharacterOutfit> = {}): CharacterOutfit {
	return normalizeCharacterOutfit(
		{
			id: "o1",
			storyId: "s1",
			character: "凛",
			name: "校服",
			upperVisible: ["upper-visible"],
			upperHidden: ["upper-hidden"],
			fullVisible: ["full-visible"],
			fullHidden: ["full-hidden"],
			...patch,
		},
		{
			id: "o1",
			storyId: "s1",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		},
	);
}

describe("分格视觉档案展开", () => {
	it("每个视角、部位与着装状态只取对应的格", () => {
		const visual = profile();
		for (const part of VISUAL_SLOT_PARTS) {
			for (const view of VISUAL_SLOT_VIEWS) {
				for (const state of VISUAL_DRESS_STATES) {
					const expanded = expandVisualProfile({
						profile: visual,
						view,
						visiblePart: part,
						state,
					});
					expect(expanded.tags).toEqual([`${part}-${view}-${state}`]);
					expect(expanded.usedBase).toBe(false);
				}
			}
		}
	});

	it("分格为空时回退到基础外貌；隐藏的部位不输出任何标签", () => {
		const visual = assertCharacterVisualProfile({
			character: "凛",
			base: ["base"],
			defaultOutfit: "校服",
		});
		const expanded = expandVisualProfile({
			profile: visual,
			view: "back",
			visiblePart: "full",
			state: "bare",
		});
		expect(expanded.tags).toEqual(["base"]);
		expect(expanded.usedBase).toBe(true);
		const hidden = expandVisualProfile({
			profile: visual,
			view: "front",
			visiblePart: "full",
			state: "hidden",
			outfit: outfit(),
		});
		expect(hidden.tags).toEqual([]);
		expect(hidden.usedBase).toBe(false);
	});

	it("着装时按上身与全身在画面里可见或隐藏拼服装标签", () => {
		const visual = profile();
		const wear = outfit();
		const face = expandVisualProfile({
			profile: visual,
			outfit: wear,
			view: "front",
			visiblePart: "face",
			state: "clothed",
		});
		expect(face.tags).toEqual([
			"face-front-clothed",
			"upper-hidden",
			"full-hidden",
		]);
		const upper = expandVisualProfile({
			profile: visual,
			outfit: wear,
			view: "back",
			visiblePart: "upper",
			state: "clothed",
		});
		expect(upper.tags).toEqual([
			"upper-back-clothed",
			"upper-visible",
			"full-hidden",
		]);
		const full = expandVisualProfile({
			profile: visual,
			outfit: wear,
			view: "front",
			visiblePart: "full",
			state: "clothed",
		});
		expect(full.tags).toEqual([
			"full-front-clothed",
			"upper-visible",
			"full-visible",
		]);
		const bare = expandVisualProfile({
			profile: visual,
			outfit: wear,
			view: "front",
			visiblePart: "full",
			state: "bare",
		});
		expect(bare.tags).toEqual(["full-front-bare"]);
	});

	it("别的角色的服装不能套用", () => {
		expect(() =>
			expandVisualProfile({
				profile: profile(),
				outfit: outfit({ character: "阿岚" }),
				view: "front",
				visiblePart: "face",
				state: "clothed",
			}),
		).toThrow("不能用在");
	});

	it("按显式选择、台账当前服装与默认服装取一套", () => {
		const wear = [
			outfit({ id: "o1", name: "校服", isDefault: true }),
			outfit({ id: "o2", name: "礼服", upperVisible: ["dress"] }),
		];
		expect(selectCharacterOutfit(wear, "凛", { selected: "礼服" })?.id).toBe(
			"o2",
		);
		expect(selectCharacterOutfit(wear, "凛")?.id).toBe("o1");
		expect(
			selectCharacterOutfit(wear, "凛", {
				profile: {
					...profile(),
					outfitPath: ["character", "凛", "outfit"],
				},
				state: { character: { 凛: { outfit: "礼服" } } },
			})?.id,
		).toBe("o2");
		expect(selectCharacterOutfit(wear, "阿岚")).toBeNull();
	});
});
