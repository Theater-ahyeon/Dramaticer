import { describe, expect, it } from "vitest";
import {
	REROLL_REASON_WILLS,
	type StoryStore,
	applyRerollReasonWill,
	createUserWillSlotProvider,
	readMemoryPrefs,
	userWillStableId,
	writeMemoryPref,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

/** 开场楼与第一轮玩家消息、回复；后续楼层由各用例自己接。 */
function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "偏好" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。",
	});
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: "a1",
		role: "user",
		raw: "我推门进去。",
	});
	store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "门后没有人。",
	});
}

function appendRound(
	store: StoryStore,
	ids: { userNodeId: string; assistantNodeId: string },
): void {
	store.appendNode({
		id: ids.userNodeId,
		storyId: "s1",
		parentId: "a2",
		role: "user",
		raw: "我继续往里走。",
	});
	store.appendNode({
		id: ids.assistantNodeId,
		storyId: "s1",
		parentId: ids.userNodeId,
		role: "assistant",
		raw: "走廊尽头有一盏灯。",
	});
}

async function contextText(store: StoryStore, nodeId: string): Promise<string> {
	const content = await createUserWillSlotProvider(store).provide({
		slot: "user_will",
		storyId: "s1",
		nodeId,
		switches: {},
		state: undefined,
	});
	return content === null
		? ""
		: content.messages.map((message) => message.content).join("\n");
}

describe("偏好来自重写原因", () => {
	it("同一原因重复选择只留一条，不同原因累积成各自的偏好", () => {
		const { store } = openTempStore();
		seedStory(store);
		const first = applyRerollReasonWill({
			store,
			storyId: "s1",
			nodeId: "a2",
			sourceNodeId: "u1",
			reason: "format",
			createdAt: "2026-11-14T00:00:00.000Z",
		});
		expect(first).toBe(true);

		appendRound(store, {
			userNodeId: "u2",
			assistantNodeId: "a3",
		});
		const repeated = applyRerollReasonWill({
			store,
			storyId: "s1",
			nodeId: "a3",
			sourceNodeId: "u2",
			reason: "format",
			createdAt: "2026-11-14T00:01:00.000Z",
		});
		expect(repeated).toBe(false);
		expect(
			applyRerollReasonWill({
				store,
				storyId: "s1",
				nodeId: "a3",
				sourceNodeId: "u2",
				reason: "too-short",
				createdAt: "2026-11-14T00:02:00.000Z",
			}),
		).toBe(true);

		const prefs = readMemoryPrefs(store, "s1");
		expect(prefs.map((pref) => pref.text).sort()).toEqual(
			[REROLL_REASON_WILLS.format, REROLL_REASON_WILLS["too-short"]].sort(),
		);
		expect(prefs.every((pref) => pref.kind === "correction")).toBe(true);
		expect(prefs.every((pref) => pref.disabled === false)).toBe(true);
		expect(prefs.map((pref) => pref.id).sort()).toEqual(
			[
				userWillStableId(REROLL_REASON_WILLS.format),
				userWillStableId(REROLL_REASON_WILLS["too-short"]),
			].sort(),
		);
	});

	it("重写原因与其它来源的纠正、底线一起进入偏好并带入上下文", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendStateDiff({
			storyId: "s1",
			nodeId: "a1",
			path: ["userWill", "will-boundary"],
			op: "set",
			value: {
				kind: "boundary",
				text: "不要让角色突然死亡",
				sourceNodeId: "u1",
				createdAt: "2026-11-13T00:00:00.000Z",
			},
			source: "settler",
		});
		applyRerollReasonWill({
			store,
			storyId: "s1",
			nodeId: "a2",
			sourceNodeId: "u1",
			reason: "off-character",
			createdAt: "2026-11-14T00:00:00.000Z",
		});

		const prefs = readMemoryPrefs(store, "s1");
		expect(prefs.map((pref) => [pref.kind, pref.text])).toEqual([
			["boundary", "不要让角色突然死亡"],
			["correction", REROLL_REASON_WILLS["off-character"]],
		]);

		const context = await contextText(store, "a2");
		expect(context).toContain("【底线】不要让角色突然死亡");
		expect(context).toContain(
			`【纠正】${REROLL_REASON_WILLS["off-character"]}`,
		);
	});
});

describe("偏好可以停用与恢复", () => {
	it("停用后不再带入上下文，恢复后回到列表并重新带入", async () => {
		const { store } = openTempStore();
		seedStory(store);
		writeMemoryPref(store, "s1", { text: "不要替我说话" });
		const created = readMemoryPrefs(store, "s1");
		expect(created).toHaveLength(1);
		const id = created[0]?.id as string;
		expect(id).toBe(userWillStableId("不要替我说话"));
		expect(await contextText(store, "a2")).toContain("不要替我说话");

		writeMemoryPref(store, "s1", { id, disabled: true });
		const disabled = readMemoryPrefs(store, "s1");
		expect(disabled).toEqual([
			{
				id,
				text: "不要替我说话",
				kind: "correction",
				origin: "已停用",
				disabled: true,
				locked: true,
			},
		]);
		expect(await contextText(store, "a2")).not.toContain("不要替我说话");

		writeMemoryPref(store, "s1", { id, disabled: false });
		const restored = readMemoryPrefs(store, "s1");
		expect(restored).toHaveLength(1);
		expect(restored[0]?.disabled).toBe(false);
		expect(restored[0]?.id).toBe(id);
		expect(await contextText(store, "a2")).toContain("不要替我说话");
	});

	it("停用一条时其余偏好仍然生效", async () => {
		const { store } = openTempStore();
		seedStory(store);
		writeMemoryPref(store, "s1", { text: "不要替我说话" });
		writeMemoryPref(store, "s1", { text: "保持轻松" });
		const first = readMemoryPrefs(store, "s1")[0];
		writeMemoryPref(store, "s1", { id: first?.id, disabled: true });

		const prefs = readMemoryPrefs(store, "s1");
		expect(prefs).toHaveLength(2);
		expect(
			prefs.filter((pref) => pref.disabled).map((pref) => pref.id),
		).toEqual([first?.id]);
		const context = await contextText(store, "a2");
		expect(context).not.toContain(first?.text as string);
		expect(context).toContain("保持轻松");
	});
});
