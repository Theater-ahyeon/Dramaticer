import { describe, expect, it } from "vitest";
import {
	WRITING_MODE_KEY,
	applyCardRecommendedConfig,
	readCardRecommendedConfig,
	readStoryCardSnapshot,
	readWritingView,
	resetToCardRecommended,
	saveStoryCardSnapshot,
	writeWritingOverrides,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const CONFIG = {
	writing: { length: "long", person: "third" },
	turnMode: "plan",
	features: { tier: "immersive", switches: { search: true, promiseLimit: 9 } },
};

describe("卡的推荐配置", () => {
	it("载入时应用写作选项、写法与功能开关", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });

		const saved = applyCardRecommendedConfig(store, "s1", CONFIG);

		expect(saved).toEqual({
			writing: { length: "long", person: "third" },
			mode: "plan",
			featureTier: "immersive",
			featureSwitches: { search: true, promiseLimit: 9 },
		});
		expect(readWritingView(store, "s1").dials).toMatchObject({
			length: "long",
			person: "third",
		});
		expect(store.getStoryValue("s1", WRITING_MODE_KEY)).toBe("plan");
		const settings = store.getStorySettings("s1");
		expect(settings.turnMode).toBe("fast");
		expect(settings.featureTier).toBe("immersive");
		expect(settings.featureSwitches).toEqual({
			search: true,
			promiseLimit: 9,
		});
		expect(readCardRecommendedConfig(store, "s1")).toEqual(saved);
	});

	it("玩家的调整叠在推荐之上，回到推荐时清掉调整", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		applyCardRecommendedConfig(store, "s1", CONFIG);

		writeWritingOverrides(store, "s1", { length: "short" });
		store.updateStorySettings("s1", {
			turnMode: "deep",
			featureTier: "lite",
			featureSwitches: { search: false },
		});
		store.setStoryValue("s1", WRITING_MODE_KEY, null);
		expect(readWritingView(store, "s1").dials.length).toBe("short");

		const view = resetToCardRecommended(store, "s1");

		expect(view.dials).toMatchObject({ length: "long", person: "third" });
		expect(view.overrides).toEqual({});
		expect(store.getStoryValue("s1", WRITING_MODE_KEY)).toBe("plan");
		const settings = store.getStorySettings("s1");
		expect(settings.turnMode).toBe("fast");
		expect(settings.featureTier).toBe("immersive");
		expect(settings.featureSwitches).toEqual({
			search: true,
			promiseLimit: 9,
		});
	});

	it("卡没推荐的项目跳过，来历不明的值丢掉", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });

		const saved = applyCardRecommendedConfig(store, "s1", {
			writing: { length: "huge", pace: "slow" },
			turnMode: "turbo",
			features: { tier: "cinema", switches: { search: "yes", nope: true } },
		});

		expect(saved).toEqual({
			writing: { pace: "slow" },
			mode: null,
			featureTier: null,
			featureSwitches: {},
		});
		expect(store.getStorySettings("s1").featureTier).toBe("standard");
		expect(readWritingView(store, "s1").recommended).toEqual({ pace: "slow" });
	});

	it("升级只换推荐与卡版本，玩家已有的调整保留", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		saveStoryCardSnapshot(store, "s1", {
			name: "云裳",
			version: "v1",
			recommendedMode: "plan",
		});
		applyCardRecommendedConfig(store, "s1", CONFIG);
		writeWritingOverrides(store, "s1", { length: "short" });

		saveStoryCardSnapshot(store, "s1", {
			name: "云裳",
			version: "v2",
			recommendedMode: "deep",
		});
		applyCardRecommendedConfig(
			store,
			"s1",
			{ writing: { length: "long" }, turnMode: "deep" },
			{ applySettings: false },
		);

		expect(readStoryCardSnapshot(store, "s1")).toMatchObject({
			name: "云裳",
			version: "v2",
			recommendedMode: "deep",
		});
		expect(readWritingView(store, "s1").overrides).toEqual({ length: "short" });
		expect(readWritingView(store, "s1").dials.length).toBe("short");
		expect(store.getStoryValue("s1", WRITING_MODE_KEY)).toBe("plan");
	});
});
