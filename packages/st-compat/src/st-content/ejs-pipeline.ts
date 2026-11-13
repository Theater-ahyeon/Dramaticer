import {
	type ContextSlotContent,
	type ContextSlotName,
	type ContextSlotProvider,
	type ContextSlotProviders,
	type ContextSlotRequest,
	type ContextTemplate,
	type JsonValue,
	PendingLedgerView,
	type PendingLedgerWrite,
	type StoryStore,
	WRITING_CONTRACT_SEGMENT_ID,
	assertJsonValue,
	isJsonObject,
} from "@dramaticer/core";
import lodash from "lodash";
import type { StCharacterCard } from "../character-card.js";
import type { StPreset } from "../preset.js";
import {
	type StEjsRuntime,
	StEjsSandbox,
	type StEjsTemplateExecutor,
	type StEjsTemplateTraceEntry,
	type StEjsTurnBudget,
	type StEjsVariableBackend,
	StEjsVariableError,
	type StEjsVariableTree,
	createStEjsRuntime,
	createStEjsSandbox,
} from "../st-ejs/index.js";
import { buildMvuCardInitState } from "../st-mvu/initvar.js";
import type { StWorldInfo } from "../world-info.js";

/** 只给来自 ST 的槽位套模板；记忆、台账、导演与写作契约等 harness 槽位原样通过。 */
export const ST_EJS_CONTENT_SLOTS: readonly ContextSlotName[] = [
	"history",
	"lore",
];

/** 静态段里出现这些标记时才值得进沙箱；普通文本逐字节保留。 */
export function hasStEjsMarkup(text: string): boolean {
	return text.includes("<%") || text.includes("<#escape-ejs>");
}

function toJsonValue(value: unknown, label: string): JsonValue {
	assertJsonValue(value, label);
	return value as JsonValue;
}

/**
 * 回合内模板预算：调用方拥有时间上限，每次模板执行按剩余时间启动。
 * 与 core 的 `TurnHookBudget` 结构一致，可以直接传给 `StEjsRuntime.render`。
 */
export function createStEjsTurnBudget(
	budgetMs: number,
	now: () => number = Date.now,
): {
	readonly budget: StEjsTurnBudget;
	readonly entries: StEjsTemplateTraceEntry[];
} {
	if (!Number.isFinite(budgetMs) || budgetMs < 0) {
		throw new Error("模板时间预算必须是非负数字");
	}
	const startedAt = now();
	const entries: StEjsTemplateTraceEntry[] = [];
	return {
		entries,
		budget: {
			remainingMs: () => Math.max(0, budgetMs - (now() - startedAt)),
			recordTemplate(entry) {
				entries.push(entry);
			},
		},
	};
}

/**
 * EJS 变量视图：`initial` 层就是台账的 `mvu` 子树。读经待结算视图，
 * 写先按结算器的校验收下，提交后成为本楼层的台账事实；global 与 message
 * 作用域仍由 `StEjsVariableStore` 保存，不写台账。
 */
class StEjsMvuVariableBackend implements StEjsVariableBackend {
	readonly #storyId: string;
	readonly #view: PendingLedgerView;

	constructor(input: {
		readonly store: StoryStore;
		readonly storyId: string;
		readonly nodeId: string;
		readonly initial: StEjsVariableTree;
	}) {
		this.#storyId = input.storyId;
		this.#view = PendingLedgerView.open(input.store, input.nodeId, ["mvu"]);
		if (this.#view.read() !== undefined) return;
		const writes: PendingLedgerWrite[] = [];
		for (const [key, value] of Object.entries(input.initial)) {
			writes.push({
				path: ["mvu", key],
				op: "set",
				value: toJsonValue(value, `初始变量 ${key}`),
			});
		}
		if (writes.length === 0) return;
		const outcome = this.#view.stage(writes, "settler");
		const rejected = outcome.rejected[0];
		if (rejected !== undefined) {
			throw new StEjsVariableError(
				`初始变量无法写入台账：${rejected.path.join(".")}：${rejected.reason}`,
			);
		}
		this.#view.commit({ storyId: this.#storyId, source: "settler" });
	}

	read(): StEjsVariableTree {
		const value = this.#view.read();
		if (value === undefined) return {};
		if (!isJsonObject(value)) {
			throw new StEjsVariableError("台账 mvu 子树必须是对象");
		}
		return lodash.cloneDeep(value);
	}

	write(key: string | null, value: unknown): void {
		const writes: PendingLedgerWrite[] = [];
		if (key === null) {
			const next = value === undefined ? {} : value;
			if (!isJsonObject(next)) {
				throw new StEjsVariableError("整棵变量树必须是对象");
			}
			const current = this.read();
			for (const existing of Object.keys(current)) {
				if (!Object.hasOwn(next, existing)) {
					writes.push({ path: ["mvu", existing], op: "delete" });
				}
			}
			for (const [name, item] of Object.entries(next)) {
				writes.push({ path: ["mvu", name], op: "set", value: item });
			}
		} else {
			const segments = lodash.toPath(key);
			const path = ["mvu", ...segments.map(String)];
			writes.push(
				value === undefined
					? { path, op: "delete" }
					: {
							path,
							op: "set",
							value: toJsonValue(value, `变量 ${key} 的值`),
						},
			);
		}
		if (writes.length === 0) return;
		const outcome = this.#view.stage(writes, "settler");
		const rejected = outcome.rejected[0];
		if (rejected !== undefined) {
			throw new StEjsVariableError(
				`变量写入被结算器拒绝：${rejected.path.join(".")}：${rejected.reason}`,
			);
		}
		this.#view.commit({ storyId: this.#storyId, source: "settler" });
	}
}

interface ActiveTurn {
	readonly nodeId: string | null;
	readonly runtime: StEjsRuntime;
	readonly executor: StEjsTemplateExecutor & {
		dispose?: () => Promise<void>;
	};
	/** 同一个回合内的模板串行执行，`define` 与变量写入按出现顺序生效。 */
	tail: Promise<void>;
}

export interface StEjsContentPipelineOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly card: StCharacterCard;
	readonly preset: StPreset | null;
	/** 世界书数据；由调用方从角色卡或导入内容里收集。 */
	readonly worlds?: readonly StWorldInfo[];
	/** `getwi` 输出的 token 上限；不传时不限制。 */
	readonly tokenBudget?: number;
	readonly estimateTokens?: (text: string) => number;
}

export interface StEjsRenderContentOptions {
	/** 台账快照所在楼层；没有楼层时变量视图为空且不写台账。 */
	readonly nodeId: string | null;
	readonly budget?: StEjsTurnBudget;
}

const EMPTY_PRESET_NAME = "current";

/**
 * 把 EJS 接到 ST 内容的入口：预设静态段、世界书与深度注入在进入槽位前渲染，
 * 变量视图读台账 `mvu` 子树。运行时与沙箱按回合创建，回合内所有模板共用一个
 * 运行时，所以 `define` 与变量写入在一个回合内跨模板可见；回合结束时释放沙箱。
 */
export class StEjsContentPipeline {
	readonly #store: StoryStore;
	readonly #storyId: string;
	readonly #card: StCharacterCard;
	readonly #preset: StPreset | null;
	readonly #worlds: readonly StWorldInfo[];
	readonly #tokenBudget: number | undefined;
	readonly #estimateTokens: ((text: string) => number) | undefined;
	#global: StEjsVariableTree = {};
	#turn: ActiveTurn | null = null;
	#generation = 0;
	#disposed = false;

	constructor(options: StEjsContentPipelineOptions) {
		this.#store = options.store;
		this.#storyId = options.storyId;
		this.#card = options.card;
		this.#preset = options.preset;
		this.#worlds = options.worlds ?? [];
		this.#tokenBudget = options.tokenBudget;
		this.#estimateTokens = options.estimateTokens;
	}

	get turnNodeId(): string | null {
		return this.#turn?.nodeId ?? null;
	}

	/**
	 * 开始一个回合。台账读写锚定在传入的楼层；同一楼层重复调用复用当前回合。
	 * 换楼层时先结束上一个回合（释放沙箱并收回 global 变量）。
	 */
	async beginTurn(nodeId: string | null): Promise<ActiveTurn> {
		if (this.#disposed) throw new Error("EJS 流水线已经释放");
		if (this.#turn !== null && this.#turn.nodeId === nodeId) return this.#turn;
		await this.#endTurn();
		const turn = this.#createTurn(nodeId);
		this.#turn = turn;
		this.#generation += 1;
		return turn;
	}

	/**
	 * 渲染模板里来自 ST 的静态段。写作契约（`protocol`）原样保留，
	 * 没有模板标记的段落逐字节不变。
	 */
	async renderTemplate(
		template: ContextTemplate,
		options: StEjsRenderContentOptions,
	): Promise<ContextTemplate> {
		const turn = await this.#acquireTurn(options.nodeId);
		const segments = [];
		for (const segment of template.segments) {
			if (
				segment.kind !== "static" ||
				segment.id === WRITING_CONTRACT_SEGMENT_ID ||
				!hasStEjsMarkup(segment.text)
			) {
				segments.push(segment);
				continue;
			}
			segments.push({
				...segment,
				text: await this.#render(turn, segment.text, {
					source: `st-ejs:preset:${segment.id}`,
					budget: options.budget,
				}),
			});
		}
		return { ...template, segments };
	}

	/** 只包 history 与 lore 槽位；harness 槽位原样返回，不经过模板。 */
	wrapProviders(providers: ContextSlotProviders): ContextSlotProviders {
		const wrapped: Partial<Record<ContextSlotName, ContextSlotProvider>> = {
			...providers,
		};
		for (const slot of ST_EJS_CONTENT_SLOTS) {
			const base = providers[slot];
			if (base === undefined) continue;
			wrapped[slot] = this.#wrapProvider(base, slot);
		}
		return wrapped;
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		await this.#endTurn();
	}

	#wrapProvider(
		base: ContextSlotProvider,
		slot: ContextSlotName,
	): ContextSlotProvider {
		const source = `st-ejs:${slot}`;
		const generation = () => this.#generation;
		return {
			get packKey() {
				return `${base.packKey ?? slot}:st-ejs:${generation()}`;
			},
			...(base.plugin === undefined ? {} : { plugin: base.plugin }),
			provide: async (request: ContextSlotRequest) => {
				const content = await base.provide(request);
				if (content === null) return null;
				const turn = await this.#acquireTurn(request.nodeId);
				const messages = [];
				for (const message of content.messages) {
					messages.push({
						role: message.role,
						content: await this.#render(turn, message.content, {
							source,
							budget: request.budget,
						}),
					});
				}
				const suffix =
					content.suffix === undefined
						? undefined
						: await this.#render(turn, content.suffix, {
								source,
								budget: request.budget,
							});
				const next: ContextSlotContent = {
					...content,
					messages,
					...(suffix === undefined ? {} : { suffix }),
				};
				return next;
			},
		};
	}

	/** 回合内所有提供者共用同一个运行时；没有活动回合时按请求楼层新建一个。 */
	async #acquireTurn(nodeId: string | null): Promise<ActiveTurn> {
		return this.#turn ?? (await this.beginTurn(nodeId));
	}

	#render(
		turn: ActiveTurn,
		text: string,
		options: { readonly source: string; readonly budget?: StEjsTurnBudget },
	): Promise<string> {
		if (!hasStEjsMarkup(text)) return Promise.resolve(text);
		const next = turn.tail.then(() =>
			turn.runtime.render(text, {
				source: options.source,
				...(options.budget === undefined ? {} : { budget: options.budget }),
			}),
		);
		turn.tail = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	#createTurn(nodeId: string | null): ActiveTurn {
		const path = nodeId === null ? [] : this.#store.getPathToNode(nodeId);
		const init = buildMvuCardInitState({
			worldBookEntries: this.#worldBookEntries(),
			firstMessage: this.#card.firstMessage,
		});
		const backend =
			nodeId === null
				? null
				: new StEjsMvuVariableBackend({
						store: this.#store,
						storyId: this.#storyId,
						nodeId,
						initial: init.state?.data ?? {},
					});
		const messages = path.map((node, index) => ({
			id: index,
			role: node.role,
			content: node.raw,
		}));
		const runtime = createStEjsRuntime({
			...(backend === null ? {} : { backend }),
			variables: {
				global: this.#global,
				messages: path.map((node, index) => ({
					id: index,
					role: node.role,
					variables: {},
				})),
			},
			messages,
			worldInfo: {
				worlds: this.#worlds,
				currentWorld: this.#worlds[0]?.name ?? null,
				messages: path.map((node) => node.raw),
			},
			data: {
				character: this.#card,
				presets:
					this.#preset === null ? {} : { [EMPTY_PRESET_NAME]: this.#preset },
				activePreset: this.#preset === null ? null : EMPTY_PRESET_NAME,
			},
			...(this.#tokenBudget === undefined
				? {}
				: { tokenBudget: this.#tokenBudget }),
			...(this.#estimateTokens === undefined
				? {}
				: { estimateTokens: this.#estimateTokens }),
		});
		const sandbox = createStEjsSandbox({ runtime });
		runtime.setExecutor(sandbox);
		return { nodeId, runtime, executor: sandbox, tail: Promise.resolve() };
	}

	#worldBookEntries(): { name: string; content: string }[] {
		if (this.#card.characterBook === null) return [];
		return this.#worlds.flatMap((world) =>
			world.entries.map((entry) => ({
				name: entry.comment,
				content: entry.content,
			})),
		);
	}

	async #endTurn(): Promise<void> {
		const turn = this.#turn;
		if (turn === null) return;
		this.#turn = null;
		this.#global = lodash.cloneDeep(
			turn.runtime.variables.read(null, { scope: "global" }),
		) as StEjsVariableTree;
		await turn.tail;
		if (turn.executor instanceof StEjsSandbox) {
			await turn.executor.dispose();
		} else {
			await turn.executor.dispose?.();
		}
	}
}

export function createStEjsContentPipeline(
	options: StEjsContentPipelineOptions,
): StEjsContentPipeline {
	return new StEjsContentPipeline(options);
}
