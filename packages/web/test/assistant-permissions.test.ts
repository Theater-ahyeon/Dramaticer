import { describe, expect, it } from "vitest";
import {
	ASSISTANT_CONVERSATION_DEFAULTS,
	ASSISTANT_PERMISSION_OPTIONS,
	ASSISTANT_THINKING_OPTIONS,
	canCancel,
	conversationStatusLabel,
	isAssistantFailure,
	permissionLabel,
	thinkingLabel,
} from "../src/assistant/permissions";

describe("助手界面设置", () => {
	it("新会话默认排障、修改前确认、跟随 writer 岗位", () => {
		expect(ASSISTANT_CONVERSATION_DEFAULTS).toEqual({
			skill: "troubleshoot",
			permission: "confirm",
			modelAlias: null,
			thinking: "off",
		});
	});

	it("三级权限与思考强度都有中文文案", () => {
		expect(ASSISTANT_PERMISSION_OPTIONS.map((item) => item.value)).toEqual([
			"read_only",
			"confirm",
			"auto",
		]);
		expect(permissionLabel("confirm")).toBe("修改前确认");
		expect(thinkingLabel("high")).toBe("高强度");
		expect(ASSISTANT_THINKING_OPTIONS.map((item) => item.value)).toEqual([
			"off",
			"low",
			"high",
		]);
	});

	it("只有运行中能取消，失败与中断进入失败标记", () => {
		expect(canCancel("running")).toBe(true);
		expect(canCancel("completed")).toBe(false);
		expect(isAssistantFailure("failed")).toBe(true);
		expect(isAssistantFailure("interrupted")).toBe(true);
		expect(isAssistantFailure("cancelled")).toBe(false);
		expect(conversationStatusLabel("cancelled")).toBe("已取消");
	});
});
