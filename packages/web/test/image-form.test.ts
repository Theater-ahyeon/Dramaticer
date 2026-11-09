import type { ImageWorkflowDetectionView } from "@dramaticer/protocol";
import { describe, expect, it } from "vitest";
import {
	buildImageSettingsDraft,
	defaultSlotSelections,
	describeImageConfigPath,
	describeImageErrorPath,
	emptySlotSelections,
	parseImageSettingsDraft,
	parseWorkflowText,
	resolveImportSlots,
	workflowNameFromFile,
} from "../src/chat/image-form";

const DETECTION: ImageWorkflowDetectionView = {
	slots: {
		positive: { nodeId: "6", input: "text" },
		negative: { nodeId: "7", input: "text" },
		seed: { nodeId: "3", input: "seed" },
		width: { nodeId: "5", input: "width" },
		height: { nodeId: "5", input: "height" },
	},
	candidates: {
		positive: [{ nodeId: "6", input: "text" }],
		negative: [
			{ nodeId: "7", input: "text" },
			{ nodeId: "8", input: "text" },
		],
		seed: [{ nodeId: "3", input: "seed" }],
		width: [{ nodeId: "5", input: "width" }],
		height: [{ nodeId: "5", input: "height" }],
	},
	unresolved: [],
};

describe("生图表单", () => {
	it("设置草稿往返转换保留四个字段", () => {
		const config = {
			mode: "auto" as const,
			workflowId: "wf-1",
			maxPerFloor: 2,
			minFloorsBetween: 7,
		};
		expect(buildImageSettingsDraft(config)).toEqual({
			mode: "auto",
			workflowId: "wf-1",
			maxPerFloor: "2",
			minFloorsBetween: "7",
		});
		const parsed = parseImageSettingsDraft(buildImageSettingsDraft(config));
		expect(parsed.errors).toEqual([]);
		expect(parsed.config).toEqual(config);
	});

	it("越界数值与未选 workflow 各自产生字段错误", () => {
		const parsed = parseImageSettingsDraft({
			mode: "manual",
			workflowId: "  ",
			maxPerFloor: "0",
			minFloorsBetween: "101",
		});
		expect(parsed.errors.map((error) => error.path)).toEqual([
			"imageConfig.maxPerFloor",
			"imageConfig.minFloorsBetween",
			"imageConfig.workflowId",
		]);
		expect(parsed.config).toMatchObject({
			maxPerFloor: 1,
			minFloorsBetween: 0,
			workflowId: "",
		});
	});

	it("关闭模式允许 workflow 为空", () => {
		const parsed = parseImageSettingsDraft({
			mode: "off",
			workflowId: "",
			maxPerFloor: "1",
			minFloorsBetween: "0",
		});
		expect(parsed.errors).toEqual([]);
		expect(parsed.config.mode).toBe("off");
	});

	it("文件名去掉 .json 后作为默认名称", () => {
		expect(workflowNameFromFile("秋叶.json")).toBe("秋叶");
		expect(workflowNameFromFile("workflow.JSON")).toBe("workflow");
		expect(workflowNameFromFile(".json")).toBe(".json");
	});

	it("workflow 文本只做 JSON 语法检查", () => {
		expect(parseWorkflowText("{").error).toContain("JSON 解析失败");
		expect(parseWorkflowText("[]").error).toBe("workflow 必须是 JSON 对象");
		const parsed = parseWorkflowText(
			'{"3":{"class_type":"KSampler","inputs":{}}}',
		);
		expect(parsed.error).toBeNull();
		expect(parsed.workflow?.["3"]?.class_type).toBe("KSampler");
	});

	it("detect 的自动插槽转成下拉框选中值", () => {
		const selections = defaultSlotSelections(DETECTION);
		expect(selections).toEqual({
			positive: "0",
			negative: "0",
			seed: "0",
			width: "0",
			height: "0",
		});
	});

	it("候选没有自动选中时保持为空", () => {
		const selections = defaultSlotSelections({
			...DETECTION,
			slots: null,
		});
		expect(selections).toEqual(emptySlotSelections());
	});

	it("正向提示词与 seed 必须选择，可选插槽留空转为 null", () => {
		const missing = resolveImportSlots(DETECTION, emptySlotSelections());
		expect(missing.slots).toBeNull();
		expect(missing.errors.map((error) => error.path)).toEqual([
			"slots.positive",
			"slots.seed",
		]);

		const selections = {
			...emptySlotSelections(),
			positive: "0",
			seed: "0",
		};
		const resolved = resolveImportSlots(DETECTION, selections);
		expect(resolved.errors).toEqual([]);
		expect(resolved.slots).toEqual({
			positive: { nodeId: "6", input: "text" },
			negative: null,
			seed: { nodeId: "3", input: "seed" },
			width: null,
			height: null,
		});
	});

	it("选择不存在的候选返回字段错误", () => {
		const resolved = resolveImportSlots(DETECTION, {
			...emptySlotSelections(),
			positive: "3",
			seed: "0",
		});
		expect(resolved.slots).toBeNull();
		expect(resolved.errors).toEqual([
			{ path: "slots.positive", message: "正向提示词插槽不在候选里" },
		]);
	});

	it("服务端字段路径翻成中文", () => {
		expect(describeImageConfigPath("imageConfig.maxPerFloor")).toBe(
			"生图配置·每楼最多插图",
		);
		expect(describeImageErrorPath("slots.negative")).toBe("负向提示词");
		expect(describeImageErrorPath("name")).toBe("workflow 名称");
		expect(describeImageErrorPath("workflow")).toBe("workflow 文件");
	});
});
