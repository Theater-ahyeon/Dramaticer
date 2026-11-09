import Database from "better-sqlite3";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	ImageWorkflowInUseError,
	LATEST_SCHEMA_VERSION,
	importImageWorkflow,
	parseComfyUiWorkflow,
	parseImagesConfig,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const env = { COMFY_URL: "http://127.0.0.1:8188" };

interface WorkflowNode {
	class_type: string;
	inputs: Record<string, unknown>;
}

function workflow(
	positive = "一只猫",
	withoutNegativeAndSize = false,
): Record<string, WorkflowNode> {
	if (withoutNegativeAndSize) {
		return {
			"3": {
				class_type: "KSampler",
				inputs: { seed: 1, positive: ["6", 0] },
			},
			"6": { class_type: "CLIPTextEncode", inputs: { text: positive } },
		};
	}
	return {
		"3": {
			class_type: "KSampler",
			inputs: {
				seed: 1,
				positive: ["6", 0],
				negative: ["7", 0],
				latent_image: ["5", 0],
			},
		},
		"5": {
			class_type: "EmptyLatentImage",
			inputs: { width: 512, height: 768 },
		},
		"6": { class_type: "CLIPTextEncode", inputs: { text: positive } },
		"7": { class_type: "CLIPTextEncode", inputs: { text: "低质量" } },
	};
}

function imagesConfig(extraProvider = ""): string {
	return `
providers:
  comfy:
    api: comfyui
    baseUrl: \${COMFY_URL}
    apiKey: ""
${extraProvider}`;
}

describe("workflow 存储与导入", () => {
	it("合法 workflow 自动识别插槽并保存；同名导入更新同一行", () => {
		const { store } = openTempStore();
		const config = parseImagesConfig(imagesConfig(), env);
		const first = importImageWorkflow(store, config, {
			name: "默认",
			workflow: workflow(),
		});
		expect(first.provider).toBe("comfy");
		expect(first.slots.positive).toEqual({ nodeId: "6", input: "text" });
		expect(first.slots.width).toEqual({ nodeId: "5", input: "width" });
		expect(store.listImageWorkflows()).toHaveLength(1);

		const second = importImageWorkflow(store, config, {
			name: "默认",
			workflow: workflow("一只狗"),
		});
		expect(second.id).toBe(first.id);
		expect(store.listImageWorkflows()).toHaveLength(1);
		expect(second.payload["6"]?.inputs.text).toBe("一只狗");
	});

	it("负向提示词与尺寸缺失时仍然可以保存", () => {
		const { store } = openTempStore();
		const config = parseImagesConfig(imagesConfig(), env);
		const raw = workflow("一只猫", true);
		const saved = importImageWorkflow(store, config, {
			name: "无负向",
			workflow: raw,
		});
		expect(saved.slots.negative).toBeNull();
		expect(saved.slots.width).toBeNull();
		expect(saved.slots.height).toBeNull();
	});

	it("未知 provider、没有 provider 与多个 provider 都拒绝", () => {
		const { store } = openTempStore();
		const config = parseImagesConfig(imagesConfig(), env);
		expect(() =>
			importImageWorkflow(store, config, {
				name: "x",
				workflow: workflow(),
				provider: "nope",
			}),
		).toThrow(/provider.*nope/);
		expect(() =>
			importImageWorkflow(
				store,
				{ providers: new Map() },
				{
					name: "x",
					workflow: workflow(),
				},
			),
		).toThrow(/provider/);
		const multiple = parseImagesConfig(
			imagesConfig(`  second:
    api: comfyui
    baseUrl: \${COMFY_URL}
    apiKey: ""
`),
			env,
		);
		expect(() =>
			importImageWorkflow(store, multiple, {
				name: "x",
				workflow: workflow(),
			}),
		).toThrow(/多个图像 provider/);
	});

	it("显式插槽指向不存在的节点时拒绝保存", () => {
		const { store } = openTempStore();
		expect(() =>
			store.saveImageWorkflow({
				name: "坏插槽",
				provider: "comfy",
				payload: parseComfyUiWorkflow(workflow()),
				slots: {
					positive: { nodeId: "99", input: "text" },
					negative: null,
					seed: { nodeId: "3", input: "seed" },
					width: null,
					height: null,
				},
			}),
		).toThrow(/slots\.positive\.nodeId/);
	});

	it("删除未被引用的 workflow；被图片记录引用时拒绝", () => {
		const { store, path } = openTempStore();
		const config = parseImagesConfig(imagesConfig(), env);
		const saved = importImageWorkflow(store, config, {
			name: "可删除",
			workflow: workflow(),
		});
		store.deleteImageWorkflow(saved.id);
		expect(store.listImageWorkflows()).toHaveLength(0);

		const referenced = importImageWorkflow(store, config, {
			name: "被引用",
			workflow: workflow(),
		});
		store.createStory({ id: "s1", title: "测试" });
		store.createStory({ id: "s2", title: "另一个" });
		store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "正文",
		});
		const db = new Database(path);
		onTestFinished(() => db.close());
		const now = new Date().toISOString();
		const insert = db.prepare(
			`INSERT INTO node_images
				(id, story_id, node_id, ordinal, status, request, workflow_id, created_at, updated_at)
			VALUES (?, ?, ?, ?, 'pending', '{}', ?, ?, ?)`,
		);
		expect(() =>
			insert.run("img-other", "s2", "n1", 0, referenced.id, now, now),
		).toThrow(/story_id 必须与所在楼层一致/);
		insert.run("img-1", "s1", "n1", 0, referenced.id, now, now);
		expect(store.countNodeImagesForWorkflow(referenced.id)).toBe(1);
		expect(() => store.deleteImageWorkflow(referenced.id)).toThrow(
			ImageWorkflowInUseError,
		);
	});

	it("迁移 v34 建好三张表与 story_settings.image_config 列", () => {
		const { store, path } = openTempStore();
		expect(store.getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION);
		const db = new Database(path);
		onTestFinished(() => db.close());
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all() as { readonly name: string }[];
		const names = tables.map((row) => row.name);
		expect(names).toContain("image_workflows");
		expect(names).toContain("character_visual_profiles");
		expect(names).toContain("node_images");
		const columns = db.pragma("table_info(story_settings)") as {
			readonly name: string;
		}[];
		expect(columns.map((column) => column.name)).toContain("image_config");
	});
});
