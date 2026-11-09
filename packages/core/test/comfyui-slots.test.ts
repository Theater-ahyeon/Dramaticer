import { describe, expect, it } from "vitest";
import {
	assertComfyUiSlots,
	detectComfyUiSlots,
	parseComfyUiWorkflow,
	resolveComfyUiSlots,
} from "../src/index.js";

interface TestWorkflowNode {
	class_type: string;
	inputs: Record<string, unknown>;
	readonly [key: string]: unknown;
}

interface TestWorkflow {
	[nodeId: string]: TestWorkflowNode;
}

function baseWorkflow(): TestWorkflow {
	return {
		"3": {
			class_type: "KSampler",
			inputs: {
				seed: 42,
				steps: 20,
				positive: ["6", 0],
				negative: ["7", 0],
				latent_image: ["5", 0],
			},
		},
		"4": {
			class_type: "CheckpointLoaderSimple",
			inputs: { ckpt_name: "model.safetensors" },
		},
		"5": {
			class_type: "EmptyLatentImage",
			inputs: { width: 512, height: 768, batch_size: 1 },
		},
		"6": {
			class_type: "CLIPTextEncode",
			inputs: { text: "a cat", clip: ["4", 1] },
		},
		"7": {
			class_type: "CLIPTextEncode",
			inputs: { text: "bad anatomy", clip: ["4", 1] },
		},
	};
}

describe("parseComfyUiWorkflow", () => {
	it("接受 API 格式与节点上的 _meta", () => {
		const workflow = baseWorkflow();
		workflow["3"] = {
			...workflow["3"],
			_meta: { title: "采样器" },
		} as (typeof workflow)["3"];
		expect(parseComfyUiWorkflow(workflow)["3"]?.class_type).toBe("KSampler");
	});

	it("缺节点、缺 class_type 或 inputs 不是对象时抛错并指出路径", () => {
		expect(() => parseComfyUiWorkflow({})).toThrow(/workflow/);
		expect(() => parseComfyUiWorkflow({ "3": { inputs: {} } })).toThrow(
			/workflow\.3\.class_type/,
		);
		expect(() =>
			parseComfyUiWorkflow({ "3": { class_type: "KSampler", inputs: [] } }),
		).toThrow(/workflow\.3\.inputs/);
		expect(() => parseComfyUiWorkflow([])).toThrow(/workflow/);
	});
});

describe("detectComfyUiSlots", () => {
	it("识别正向、负向、seed、宽度与高度", () => {
		const detection = detectComfyUiSlots(parseComfyUiWorkflow(baseWorkflow()));
		expect(detection.slots).toEqual({
			positive: { nodeId: "6", input: "text" },
			negative: { nodeId: "7", input: "text" },
			seed: { nodeId: "3", input: "seed" },
			width: { nodeId: "5", input: "width" },
			height: { nodeId: "5", input: "height" },
		});
		expect(detection.unresolved).toEqual([]);
	});

	it("负向与尺寸缺失时仍然自动采用其余插槽", () => {
		const workflow = baseWorkflow();
		workflow["3"].inputs = {
			seed: 1,
			positive: ["6", 0],
		};
		const detection = detectComfyUiSlots(parseComfyUiWorkflow(workflow));
		expect(detection.slots).toEqual({
			positive: { nodeId: "6", input: "text" },
			negative: null,
			seed: { nodeId: "3", input: "seed" },
			width: null,
			height: null,
		});
		expect(detection.unresolved).toEqual([]);
	});

	it("KSamplerAdvanced 使用 noise_seed", () => {
		const workflow = baseWorkflow();
		workflow["3"].class_type = "KSamplerAdvanced";
		workflow["3"].inputs = {
			noise_seed: 7,
			positive: ["6", 0],
			negative: ["7", 0],
		};
		const detection = detectComfyUiSlots(parseComfyUiWorkflow(workflow));
		expect(detection.slots?.seed).toEqual({ nodeId: "3", input: "noise_seed" });
	});

	it("缺少 seed 时不自动采用", () => {
		const workflow = baseWorkflow();
		workflow["3"].inputs = {
			positive: ["6", 0],
			negative: ["7", 0],
			latent_image: ["5", 0],
		};
		const detection = detectComfyUiSlots(parseComfyUiWorkflow(workflow));
		expect(detection.slots).toBeNull();
		expect(detection.unresolved).toContain("seed");
		expect(() => resolveComfyUiSlots(parseComfyUiWorkflow(workflow))).toThrow(
			/slots.*seed/,
		);
	});

	it("多采样器只返回候选，不自动采用", () => {
		const workflow = baseWorkflow();
		workflow["8"] = {
			class_type: "KSampler",
			inputs: {
				seed: 43,
				positive: ["9", 0],
				negative: ["7", 0],
				latent_image: ["5", 0],
			},
		} as (typeof workflow)["3"];
		workflow["9"] = {
			class_type: "CLIPTextEncode",
			inputs: { text: "a dog", clip: ["4", 1] },
		} as (typeof workflow)["6"];
		const detection = detectComfyUiSlots(parseComfyUiWorkflow(workflow));
		expect(detection.slots).toBeNull();
		expect(detection.candidates.positive).toEqual([
			{ nodeId: "6", input: "text" },
			{ nodeId: "9", input: "text" },
		]);
		expect(detection.unresolved).toContain("positive");
	});

	it("链接指向不存在的节点或格式不合法时抛错并指出路径", () => {
		const missing = baseWorkflow();
		missing["3"].inputs.positive = ["99", 0];
		expect(() => detectComfyUiSlots(parseComfyUiWorkflow(missing))).toThrow(
			/workflow\.3\.inputs\.positive/,
		);

		const malformed = baseWorkflow();
		malformed["3"].inputs.latent_image = ["5"] as never;
		expect(() => detectComfyUiSlots(parseComfyUiWorkflow(malformed))).toThrow(
			/workflow\.3\.inputs\.latent_image/,
		);
	});

	it("seed 不是整数时抛错", () => {
		const workflow = baseWorkflow();
		workflow["3"].inputs.seed = "42" as never;
		expect(() => detectComfyUiSlots(parseComfyUiWorkflow(workflow))).toThrow(
			/workflow\.3\.inputs\.seed/,
		);
	});
});

describe("assertComfyUiSlots", () => {
	const workflow = parseComfyUiWorkflow(baseWorkflow());

	it("接受完整插槽并把可选项留空", () => {
		const slots = assertComfyUiSlots(workflow, {
			positive: { nodeId: "6", input: "text" },
			negative: null,
			seed: { nodeId: "3", input: "seed" },
			width: null,
			height: null,
		});
		expect(slots.negative).toBeNull();
	});

	it("节点、输入不存在或类型不符时指出字段路径", () => {
		expect(() =>
			assertComfyUiSlots(workflow, {
				positive: { nodeId: "99", input: "text" },
				seed: { nodeId: "3", input: "seed" },
			}),
		).toThrow(/slots\.positive\.nodeId/);
		expect(() =>
			assertComfyUiSlots(workflow, {
				positive: { nodeId: "6", input: "missing" },
				seed: { nodeId: "3", input: "seed" },
			}),
		).toThrow(/slots\.positive\.input/);
		expect(() =>
			assertComfyUiSlots(workflow, {
				positive: { nodeId: "3", input: "seed" },
				seed: { nodeId: "3", input: "seed" },
			}),
		).toThrow(/slots\.positive\.input/);
		expect(() =>
			assertComfyUiSlots(workflow, {
				positive: { nodeId: "6", input: "text" },
				seed: { nodeId: "6", input: "text" },
			}),
		).toThrow(/slots\.seed\.input/);
		expect(() =>
			assertComfyUiSlots(workflow, {
				positive: { nodeId: "6", input: "text" },
				seed: { nodeId: "3", input: "seed" },
				width: { nodeId: "6", input: "text" },
			}),
		).toThrow(/slots\.width\.input/);
	});

	it("缺必需插槽、未知字段与非法形状都抛错", () => {
		expect(() =>
			assertComfyUiSlots(workflow, { seed: { nodeId: "3", input: "seed" } }),
		).toThrow(/slots\.positive/);
		expect(() =>
			assertComfyUiSlots(workflow, {
				positive: { nodeId: "6", input: "text" },
				seed: { nodeId: "3", input: "seed" },
				extra: { nodeId: "6", input: "text" },
			}),
		).toThrow(/slots\.extra/);
		expect(() =>
			assertComfyUiSlots(workflow, {
				positive: { nodeId: "6" },
				seed: { nodeId: "3", input: "seed" },
			}),
		).toThrow(/slots\.positive\.input/);
		expect(() => assertComfyUiSlots(workflow, null)).toThrow(/slots/);
	});
});
