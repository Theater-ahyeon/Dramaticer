import type { ContextCondition, ContextTemplate } from "@dramaticer/core";
import { describe, expect, it } from "vitest";
import {
	BLOCK_FORMAT_SEGMENT_ID,
	addBlockFormatSegment,
	addSlotSegment,
	addStaticSegment,
	buildContextTemplate,
	conditionDraftFrom,
	conditionDraftTo,
	describeConditionDraft,
	describeTemplateSegments,
	hasBlockFormatSegment,
	moveSegmentDraft,
	removeBlockFormatSegment,
	removeSegmentDraft,
	segmentDraftFrom,
	switchConditionKind,
	templateDraftFrom,
	updateSegmentDraft,
	validateTemplateDraft,
} from "../src/chat/template-form";

function templateFixture(): ContextTemplate {
	return {
		id: "custom",
		segments: [
			{ id: "character", kind: "slot", slot: "character", priority: 90 },
			{
				id: "lore",
				kind: "slot",
				slot: "lore",
				when: { kind: "switch", name: "lore" },
			},
			{ id: "protocol", kind: "static", text: "契约", priority: 95 },
		],
	};
}

describe("模板表单", () => {
	it("草稿顺序就是组装顺序与预览顺序", () => {
		const draft = templateDraftFrom(templateFixture(), "模板甲");
		expect(describeTemplateSegments(draft).map((row) => row.id)).toEqual([
			"character",
			"lore",
			"protocol",
		]);
		expect(describeTemplateSegments(draft).map((row) => row.detail)).toEqual([
			"角色",
			"世界书",
			"契约",
		]);
		expect(describeTemplateSegments(draft)[1]?.condition).toBe(
			"开关 lore 为真",
		);
	});

	it("新增静态段与槽位段插在 protocol 之前，id 递增", () => {
		let draft = templateDraftFrom(templateFixture(), "模板甲");
		draft = addStaticSegment(draft);
		draft = addSlotSegment(draft, "memory");
		expect(draft.segments.map((segment) => segment.id)).toEqual([
			"character",
			"lore",
			"segment-1",
			"segment-2",
			"protocol",
		]);
		expect(draft.segments[2]?.kind).toBe("static");
		expect(draft.segments[3]?.slot).toBe("memory");
	});

	it("上下移动与删除改变顺序，越界保持原样", () => {
		const draft = templateDraftFrom(templateFixture(), "模板甲");
		const moved = moveSegmentDraft(draft, 0, 1);
		expect(moved.segments.map((segment) => segment.id)).toEqual([
			"lore",
			"character",
			"protocol",
		]);
		expect(moveSegmentDraft(draft, 0, -1)).toBe(draft);
		expect(moveSegmentDraft(draft, 2, 1)).toBe(draft);
		expect(
			removeSegmentDraft(draft, 1).segments.map((segment) => segment.id),
		).toEqual(["character", "protocol"]);
	});

	it("空静态文本、重复 id、protocol 不在最后与空模板都被拒绝", () => {
		let draft = templateDraftFrom(templateFixture(), "模板甲");
		draft = updateSegmentDraft(draft, 2, { text: "" });
		draft = updateSegmentDraft(draft, 1, { id: "character" });
		const errors = validateTemplateDraft(draft);
		expect(errors.map((error) => error.path)).toContain(
			"template.segments[1].id",
		);
		expect(errors.map((error) => error.path)).toContain(
			"template.segments[2].text",
		);

		const moved = moveSegmentDraft(
			templateDraftFrom(templateFixture(), "模板甲"),
			2,
			-1,
		);
		expect(validateTemplateDraft(moved).map((error) => error.path)).toContain(
			"template.segments[1]",
		);
		expect(validateTemplateDraft(moved)[0]?.message).toContain(
			"写作契约必须是最后一个片段",
		);

		expect(
			validateTemplateDraft({ id: "empty", name: "空", segments: [] }).map(
				(error) => error.path,
			),
		).toEqual(["template.segments"]);
		expect(
			validateTemplateDraft({ id: "", name: "空", segments: [] }).map(
				(error) => error.path,
			),
		).toEqual(["template.id", "template.segments"]);
	});

	it("条件草稿往返与非法条件报错", () => {
		const conditions: readonly ContextCondition[] = [
			{ kind: "switch", name: "director" },
			{ kind: "switch", name: "memory", equals: false },
			{ kind: "state", path: ["角色", "卫宫"], op: "equals", value: 3 },
			{ kind: "state", path: ["场景"], op: "truthy" },
			{
				kind: "all",
				conditions: [
					{ kind: "switch", name: "a" },
					{ kind: "any", conditions: [] },
				],
			},
			{
				kind: "not",
				condition: { kind: "state", path: ["x"], op: "exists" },
			},
		];
		for (const condition of conditions) {
			const result = conditionDraftTo(conditionDraftFrom(condition), "when");
			expect(result.errors).toEqual([]);
			expect(result.condition).toEqual(condition);
		}

		expect(
			conditionDraftTo({ kind: "switch", name: " ", equals: true }, "when"),
		).toEqual({
			condition: null,
			errors: [{ path: "when.name", message: "开关名不能为空" }],
		});
		expect(
			conditionDraftTo(
				{ kind: "state", path: "场景..地点", op: "exists", valueText: "" },
				"when",
			).errors.map((error) => error.path),
		).toEqual(["when.path"]);
		expect(
			conditionDraftTo(
				{ kind: "state", path: "场景", op: "equals", valueText: "{坏" },
				"when",
			).errors.map((error) => error.path),
		).toEqual(["when.value"]);
		expect(
			conditionDraftTo(
				{
					kind: "all",
					conditions: [
						{ kind: "switch", name: "ok", equals: true },
						{ kind: "switch", name: "", equals: true },
					],
				},
				"when",
			).errors.map((error) => error.path),
		).toEqual(["when.conditions[1].name"]);
	});

	it("切换条件类型时保留能沿用的部分", () => {
		const fromSwitch = switchConditionKind(
			{ kind: "switch", name: "lore", equals: false },
			"all",
		);
		expect(fromSwitch).toEqual({
			kind: "all",
			conditions: [{ kind: "switch", name: "lore", equals: false }],
		});
		expect(
			switchConditionKind(
				{ kind: "state", path: "场景", op: "exists", valueText: "" },
				"switch",
			),
		).toEqual({ kind: "switch", name: "", equals: true });
		expect(switchConditionKind(null, "not")).toEqual({
			kind: "not",
			condition: { kind: "switch", name: "", equals: true },
		});
		expect(
			describeConditionDraft({
				kind: "not",
				condition: { kind: "state", path: "场景", op: "truthy", valueText: "" },
			}),
		).toBe("非（状态 场景 为真）");
	});
});

describe("block_format 段落", () => {
	it("增删与 structuredOutput 无关", () => {
		const base = templateDraftFrom(templateFixture(), "模板甲");
		for (const text of ["文本标签写法的说明", "工具调用写法的说明"]) {
			const added = addBlockFormatSegment(base, {
				id: BLOCK_FORMAT_SEGMENT_ID,
				kind: "static",
				text,
				priority: 95,
			});
			expect(hasBlockFormatSegment(added)).toBe(true);
			expect(added.segments.map((segment) => segment.id)).toEqual([
				"character",
				"lore",
				BLOCK_FORMAT_SEGMENT_ID,
				"protocol",
			]);
			expect(
				addBlockFormatSegment(added, {
					id: BLOCK_FORMAT_SEGMENT_ID,
					kind: "static",
					text: "重复",
					priority: 95,
				}),
			).toBe(added);
			expect(
				removeBlockFormatSegment(added).segments.map((segment) => segment.id),
			).toEqual(["character", "lore", "protocol"]);
		}
	});

	it("草稿转协议对象时省略空优先级", () => {
		let draft = templateDraftFrom(templateFixture(), "模板甲");
		draft = updateSegmentDraft(draft, 0, { priority: "" });
		draft = updateSegmentDraft(draft, 1, {
			condition: { kind: "switch", name: "lore", equals: false },
		});
		expect(validateTemplateDraft(draft)).toEqual([]);
		const template = buildContextTemplate(draft);
		expect(template.segments[0]).toEqual({
			id: "character",
			kind: "slot",
			slot: "character",
		});
		expect(template.segments[1]?.when).toEqual({
			kind: "switch",
			name: "lore",
			equals: false,
		});
		expect(
			segmentDraftFrom({
				id: "plain",
				kind: "slot",
				slot: "history",
			} as const),
		).toEqual({
			id: "plain",
			kind: "slot",
			text: "",
			slot: "history",
			priority: "",
			condition: null,
		});
	});
});
