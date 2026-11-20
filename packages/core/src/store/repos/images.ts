// StoryStore 的领域仓储：出图工作流与楼层插图（refactor/05）。
// 公开方法由 StoryStore 原样委托过来，签名不变；跨领域调用经 this.store。
import { randomUUID } from "node:crypto";
import { validateImagePromptRequest } from "../../images/request.js";
import {
	assertComfyUiSlots,
	parseComfyUiWorkflow,
} from "../../images/slots.js";
import {
	ImageWorkflowInUseError,
	type ImageWorkflowRecord,
	type NewNodeImageInput,
	type NodeImageRecord,
	type SaveImageWorkflowInput,
	isNodeImageStatus,
} from "../../images/types.js";
import { serializeJsonValue } from "../json-value.js";
import { StoreRepo } from "./base.js";
import { assertNonEmptyString } from "./shared.js";

interface ImageWorkflowRow {
	readonly id: string;
	readonly name: string;
	readonly provider: string;
	readonly payload: string;
	readonly slots: string;
	readonly created_at: string;
	readonly updated_at: string;
}

interface NodeImageRow {
	readonly id: string;
	readonly story_id: string;
	readonly node_id: string;
	readonly ordinal: number;
	readonly status: string;
	readonly request: string;
	readonly prompt: string | null;
	readonly negative_prompt: string | null;
	readonly workflow_id: string;
	readonly seed: number | null;
	readonly attempts: number;
	readonly file_name: string | null;
	readonly media_type: string | null;
	readonly width: number | null;
	readonly height: number | null;
	readonly error: string | null;
	readonly created_at: string;
	readonly updated_at: string;
}

function rowToImageWorkflow(row: ImageWorkflowRow): ImageWorkflowRecord {
	const workflow = parseComfyUiWorkflow(
		JSON.parse(row.payload) as unknown,
		`图片 workflow ${row.id} 的 payload`,
	);
	const slots = assertComfyUiSlots(
		workflow,
		JSON.parse(row.slots) as unknown,
		`图片 workflow ${row.id} 的 slots`,
	);
	return {
		id: row.id,
		name: row.name,
		provider: row.provider,
		payload: workflow,
		slots,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToNodeImage(row: NodeImageRow): NodeImageRecord {
	if (!isNodeImageStatus(row.status)) {
		throw new Error(`图片记录 ${row.id} 的状态不合法：${row.status}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		nodeId: row.node_id,
		ordinal: row.ordinal,
		status: row.status,
		request: validateImagePromptRequest(
			JSON.parse(row.request) as unknown,
			`图片记录 ${row.id} 的 request`,
		),
		prompt: row.prompt,
		negativePrompt: row.negative_prompt,
		workflowId: row.workflow_id,
		seed: row.seed,
		attempts: row.attempts,
		fileName: row.file_name,
		mediaType: row.media_type,
		width: row.width,
		height: row.height,
		error: row.error,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export class ImagesRepo extends StoreRepo {
	/** 列出所有 workflow，按创建顺序。 */
	listImageWorkflows(): ImageWorkflowRecord[] {
		const rows = this.db
			.prepare("SELECT * FROM image_workflows ORDER BY created_at ASC, id ASC")
			.all() as ImageWorkflowRow[];
		return rows.map(rowToImageWorkflow);
	}

	/** 读取一个 workflow；不存在时返回 null。 */
	getImageWorkflow(id: string): ImageWorkflowRecord | null {
		assertNonEmptyString(id, "图片 workflow id");
		const row = this.db
			.prepare("SELECT * FROM image_workflows WHERE id = ?")
			.get(id) as ImageWorkflowRow | undefined;
		return row === undefined ? null : rowToImageWorkflow(row);
	}

	/** 保存 workflow；同名导入更新同一行，id 与创建时间不变。 */
	saveImageWorkflow(input: SaveImageWorkflowInput): ImageWorkflowRecord {
		const name = input.name.trim();
		if (name.length === 0) {
			throw new Error("图片 workflow 的 name 必须是非空字符串");
		}
		const provider = input.provider.trim();
		if (provider.length === 0) {
			throw new Error("图片 workflow 的 provider 必须是非空字符串");
		}
		const workflow = parseComfyUiWorkflow(
			input.payload,
			"图片 workflow 的 payload",
		);
		const slots = assertComfyUiSlots(
			workflow,
			input.slots,
			"图片 workflow 的 slots",
		);
		const now = new Date().toISOString();
		this.db
			.prepare(
				`INSERT INTO image_workflows
					(id, name, provider, payload, slots, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(name) DO UPDATE SET
					provider = excluded.provider,
					payload = excluded.payload,
					slots = excluded.slots,
					updated_at = excluded.updated_at`,
			)
			.run(
				randomUUID(),
				name,
				provider,
				serializeJsonValue(workflow, "图片 workflow 的 payload"),
				serializeJsonValue(slots, "图片 workflow 的 slots"),
				now,
				now,
			);
		const row = this.db
			.prepare("SELECT * FROM image_workflows WHERE name = ?")
			.get(name) as ImageWorkflowRow | undefined;
		if (row === undefined) {
			throw new Error(`图片 workflow 写入后读取失败：${name}`);
		}
		return rowToImageWorkflow(row);
	}

	/** 删除没有被图片记录引用的 workflow。 */
	deleteImageWorkflow(id: string): void {
		assertNonEmptyString(id, "图片 workflow id");
		this.db.transaction((): void => {
			const row = this.db
				.prepare("SELECT id FROM image_workflows WHERE id = ?")
				.get(id) as { readonly id: string } | undefined;
			if (row === undefined) {
				throw new Error(`图片 workflow 不存在：${id}`);
			}
			const imageCount = this.countNodeImagesForWorkflow(id);
			if (imageCount > 0) {
				throw new ImageWorkflowInUseError(id, imageCount);
			}
			this.db.prepare("DELETE FROM image_workflows WHERE id = ?").run(id);
		})();
	}

	/** 统计引用某个 workflow 的图片记录数。 */
	countNodeImagesForWorkflow(workflowId: string): number {
		assertNonEmptyString(workflowId, "图片 workflow id");
		const row = this.db
			.prepare(
				"SELECT COUNT(*) AS count FROM node_images WHERE workflow_id = ?",
			)
			.get(workflowId) as { readonly count: number };
		return row.count;
	}

	/** 楼层上的图片记录，按 ordinal 排序。 */
	listNodeImages(nodeId: string): NodeImageRecord[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		const rows = this.db
			.prepare(
				"SELECT * FROM node_images WHERE node_id = ? ORDER BY ordinal ASC",
			)
			.all(nodeId) as NodeImageRow[];
		return rows.map(rowToNodeImage);
	}

	/** 一批楼层上的图片记录，一次查询完成，按楼层与序号排序。 */
	listNodeImagesForNodes(nodeIds: readonly string[]): NodeImageRecord[] {
		const unique = [...new Set(nodeIds)];
		if (unique.length === 0) return [];
		for (const nodeId of unique) {
			assertNonEmptyString(nodeId, "楼层节点 id");
		}
		const placeholders = unique.map(() => "?").join(", ");
		const rows = this.db
			.prepare(
				`SELECT * FROM node_images WHERE node_id IN (${placeholders})
				ORDER BY node_id ASC, ordinal ASC`,
			)
			.all(...unique) as NodeImageRow[];
		return rows.map(rowToNodeImage);
	}

	/** 故事里全部图片记录，按楼层与序号排序。 */
	listStoryNodeImages(storyId: string): NodeImageRecord[] {
		assertNonEmptyString(storyId, "故事 id");
		const rows = this.db
			.prepare(
				"SELECT * FROM node_images WHERE story_id = ? ORDER BY node_id ASC, ordinal ASC",
			)
			.all(storyId) as NodeImageRow[];
		return rows.map(rowToNodeImage);
	}

	/** 按创建顺序读取待出图的记录；不传 limit 时返回全部。 */
	listPendingNodeImages(storyId: string, limit?: number): NodeImageRecord[] {
		assertNonEmptyString(storyId, "故事 id");
		if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
			throw new Error("待出图记录的条数必须是正整数");
		}
		const rows = this.db
			.prepare(
				`SELECT * FROM node_images
				WHERE story_id = ? AND status = 'pending'
				ORDER BY created_at ASC, id ASC
				LIMIT ?`,
			)
			.all(storyId, limit ?? -1) as NodeImageRow[];
		return rows.map(rowToNodeImage);
	}

	getNodeImage(id: string): NodeImageRecord | null {
		assertNonEmptyString(id, "图片记录 id");
		const row = this.db
			.prepare("SELECT * FROM node_images WHERE id = ?")
			.get(id) as NodeImageRow | undefined;
		return row === undefined ? null : rowToNodeImage(row);
	}

	/** 楼层已经接受了多少张图；失败的行也占一个位次。 */
	countNodeImages(nodeId: string): number {
		assertNonEmptyString(nodeId, "楼层节点 id");
		const row = this.db
			.prepare("SELECT COUNT(*) AS count FROM node_images WHERE node_id = ?")
			.get(nodeId) as { readonly count: number };
		return row.count;
	}

	/** 故事里出现过图片的楼层 id，用来计算两次出图之间的楼层间隔。 */
	listNodeImageNodeIds(storyId: string): string[] {
		assertNonEmptyString(storyId, "故事 id");
		const rows = this.db
			.prepare(
				"SELECT DISTINCT node_id FROM node_images WHERE story_id = ? ORDER BY node_id ASC",
			)
			.all(storyId) as { readonly node_id: string }[];
		return rows.map((row) => row.node_id);
	}

	/** 登记一条待出图记录；序号在同一楼层的写入事务里递增。 */
	insertNodeImage(input: NewNodeImageInput): NodeImageRecord {
		assertNonEmptyString(input.storyId, "图片记录的故事 id");
		assertNonEmptyString(input.nodeId, "图片记录的楼层 id");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const node = this.store.getNode(input.nodeId);
		if (node === null) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`图片记录的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		if (node.role !== "assistant") {
			throw new Error(`图片只能挂在助手楼层上：${input.nodeId}`);
		}
		const request = validateImagePromptRequest(input.request);
		if (input.seed !== null) {
			if (
				typeof input.seed !== "number" ||
				!Number.isInteger(input.seed) ||
				input.seed < 0 ||
				input.seed > Number.MAX_SAFE_INTEGER
			) {
				throw new Error("图片记录的 seed 必须是非负整数或 null");
			}
		}
		if (this.getImageWorkflow(input.workflowId) === null) {
			throw new Error(`图片 workflow 不存在：${input.workflowId}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "图片记录的创建时间");
		const id = randomUUID();
		this.db.transaction((): void => {
			const ordinal = this.countNodeImages(input.nodeId);
			this.db
				.prepare(
					`INSERT INTO node_images
						(id, story_id, node_id, ordinal, status, request, workflow_id,
						 seed, attempts, created_at, updated_at)
					VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, 0, ?, ?)`,
				)
				.run(
					id,
					input.storyId,
					input.nodeId,
					ordinal,
					serializeJsonValue(request, "图片记录的 request"),
					input.workflowId,
					input.seed,
					createdAt,
					createdAt,
				);
		})();
		const saved = this.getNodeImage(id);
		if (saved === null) {
			throw new Error(`图片记录写入后读取失败：${id}`);
		}
		return saved;
	}

	/** 把待出图记录标为执行中，并写入编译后的提示词。 */
	startNodeImage(
		id: string,
		input: {
			readonly prompt: string;
			readonly negativePrompt: string;
			readonly updatedAt?: string;
		},
	): NodeImageRecord {
		const image = this.#requireNodeImage(id);
		if (image.status !== "pending") {
			throw new Error(
				`图片记录 ${id} 的状态是 ${image.status}，只有 pending 可以开始执行`,
			);
		}
		const updatedAt = input.updatedAt ?? new Date().toISOString();
		assertNonEmptyString(updatedAt, "图片记录的更新时间");
		this.db
			.prepare(
				`UPDATE node_images
				SET status = 'running', prompt = ?, negative_prompt = ?, updated_at = ?
				WHERE id = ?`,
			)
			.run(input.prompt, input.negativePrompt, updatedAt, id);
		return this.#requireNodeImage(id);
	}

	/** 出图完成：写入文件元数据与宽高。 */
	finishNodeImage(
		id: string,
		input: {
			readonly fileName: string;
			readonly mediaType: string;
			readonly width: number;
			readonly height: number;
			readonly updatedAt?: string;
		},
	): NodeImageRecord {
		const image = this.#requireNodeImage(id);
		if (image.status !== "running") {
			throw new Error(
				`图片记录 ${id} 的状态是 ${image.status}，只有 running 可以完成`,
			);
		}
		assertNonEmptyString(input.fileName, "图片文件名");
		assertNonEmptyString(input.mediaType, "图片媒体类型");
		if (!Number.isInteger(input.width) || input.width < 1) {
			throw new Error("图片宽度必须是正整数");
		}
		if (!Number.isInteger(input.height) || input.height < 1) {
			throw new Error("图片高度必须是正整数");
		}
		const updatedAt = input.updatedAt ?? new Date().toISOString();
		assertNonEmptyString(updatedAt, "图片记录的更新时间");
		this.db
			.prepare(
				`UPDATE node_images
				SET status = 'done', file_name = ?, media_type = ?, width = ?,
					height = ?, error = NULL, updated_at = ?
				WHERE id = ?`,
			)
			.run(
				input.fileName,
				input.mediaType,
				input.width,
				input.height,
				updatedAt,
				id,
			);
		return this.#requireNodeImage(id);
	}

	/** 单行失败：累计次数，达到上限后标为失败，否则退回待办。 */
	failNodeImage(
		id: string,
		input: {
			readonly error: string;
			readonly maxAttempts: number;
			readonly updatedAt?: string;
		},
	): NodeImageRecord {
		const image = this.#requireNodeImage(id);
		if (image.status !== "running") {
			throw new Error(
				`图片记录 ${id} 的状态是 ${image.status}，只有 running 可以失败`,
			);
		}
		if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
			throw new Error("图片记录的最大尝试次数必须是正整数");
		}
		const attempts = image.attempts + 1;
		const status = attempts >= input.maxAttempts ? "failed" : "pending";
		const updatedAt = input.updatedAt ?? new Date().toISOString();
		assertNonEmptyString(updatedAt, "图片记录的更新时间");
		this.db
			.prepare(
				`UPDATE node_images
				SET status = ?, attempts = ?, error = ?, updated_at = ?
				WHERE id = ?`,
			)
			.run(
				status,
				attempts,
				input.error.length > 0 ? input.error : "出图失败",
				updatedAt,
				id,
			);
		return this.#requireNodeImage(id);
	}

	/**
	 * 进程在执行中途退出后，running 行不会被任务取到；启动时退回 pending。
	 * 失败次数只在真正失败时累计，这里不改。
	 */
	requeueRunningNodeImages(storyId?: string): number {
		if (storyId !== undefined) assertNonEmptyString(storyId, "故事 id");
		const result = this.db
			.prepare(
				`UPDATE node_images
				SET status = 'pending', updated_at = @updatedAt
				WHERE status = 'running' AND (@storyId IS NULL OR story_id = @storyId)`,
			)
			.run({
				storyId: storyId ?? null,
				updatedAt: new Date().toISOString(),
			});
		return result.changes;
	}

	/** 手动重试：只接受 failed 行，退回 pending 并清零失败次数。 */
	retryNodeImage(id: string): NodeImageRecord {
		const image = this.#requireNodeImage(id);
		if (image.status !== "failed") {
			throw new Error(
				`图片记录 ${id} 的状态是 ${image.status}，只有 failed 可以重试`,
			);
		}
		this.db
			.prepare(
				`UPDATE node_images
				SET status = 'pending', attempts = 0, error = NULL, updated_at = ?
				WHERE id = ?`,
			)
			.run(new Date().toISOString(), id);
		return this.#requireNodeImage(id);
	}

	#requireNodeImage(id: string): NodeImageRecord {
		const image = this.getNodeImage(id);
		if (image === null) throw new Error(`图片记录不存在：${id}`);
		return image;
	}
}
