import {
	type BackgroundJobEntry,
	createBackgroundJobRegistry,
} from "../background/registry.js";
import type { BackgroundJobType } from "../background/types.js";
import type { BlockTypeDefinition } from "../blocks/types.js";
import { createBlockTypeRegistry } from "../blocks/types.js";
import type { ContextSlotProvider } from "../context/assembler.js";
import {
	type ContextSlotName,
	isContextSlotName,
} from "../context/slot-names.js";
import type { DeepToolDefinition, ToolPhase } from "../tools/registry.js";
import { createDeepToolRegistry, isToolPhase } from "../tools/registry.js";
import type { RegisteredBackgroundJob } from "./contracts.js";

interface RegisteredSlot {
	readonly plugin: string;
	readonly provider: ContextSlotProvider;
}

interface RegisteredBlockType {
	readonly plugin: string;
	readonly definition: BlockTypeDefinition;
}

interface RegisteredTool {
	readonly plugin: string;
	readonly definition: DeepToolDefinition;
	readonly phases: readonly ToolPhase[];
}

/** 扩展点注册表；每次注册返回一个幂等的撤销函数。 */
export class ExtensionRegistry {
	private readonly slotsByName = new Map<ContextSlotName, RegisteredSlot[]>();
	private readonly blockTypesByName = new Map<string, RegisteredBlockType>();
	private readonly backgroundJobsByKind = new Map<
		string,
		RegisteredBackgroundJob
	>();
	private readonly toolsByName = new Map<string, RegisteredTool>();

	addSlot(
		name: string,
		plugin: string,
		provider: ContextSlotProvider,
	): () => void {
		if (!isContextSlotName(name)) {
			throw new Error(`未知的上下文槽位：${name}`);
		}
		if (typeof provider.provide !== "function") {
			throw new Error(`槽位 ${name} 的提供者必须有 provide 方法`);
		}
		const registered: RegisteredSlot = { plugin, provider };
		const list = this.slotsByName.get(name) ?? [];
		list.push(registered);
		this.slotsByName.set(name, list);
		return () => {
			const current = this.slotsByName.get(name);
			if (!current) return;
			const index = current.indexOf(registered);
			if (index < 0) return;
			current.splice(index, 1);
			if (current.length === 0) this.slotsByName.delete(name);
		};
	}

	addBlockType(plugin: string, definition: BlockTypeDefinition): () => void {
		const existing = [...this.blockTypesByName.values()].map(
			(entry) => entry.definition,
		);
		// 复用 core 的块类型校验：名称、显示策略、上下文策略与语义策略。
		createBlockTypeRegistry([...existing, definition]);
		if (this.blockTypesByName.has(definition.name)) {
			throw new Error(`块类型重复注册：${definition.name}`);
		}
		this.blockTypesByName.set(definition.name, { plugin, definition });
		return () => {
			if (this.blockTypesByName.get(definition.name)?.plugin !== plugin) return;
			this.blockTypesByName.delete(definition.name);
		};
	}

	/** 复用后台任务注册表的校验：类型名、入队条件、档位与 needsRun。 */
	addBackgroundJob(
		plugin: string,
		kind: string,
		entry: BackgroundJobEntry,
	): () => void {
		if (this.backgroundJobsByKind.has(kind)) {
			throw new Error(`后台任务类型重复注册：${kind}`);
		}
		const validated = createBackgroundJobRegistry({ [kind]: entry }).get(kind);
		if (!validated) throw new Error(`后台任务类型注册失败：${kind}`);
		this.backgroundJobsByKind.set(kind, { plugin, kind, type: validated });
		return () => {
			if (this.backgroundJobsByKind.get(kind)?.plugin !== plugin) return;
			this.backgroundJobsByKind.delete(kind);
		};
	}

	/** 复用工具注册表的校验：名称、权限级别与进度阶段文字。 */
	addTool(
		plugin: string,
		definition: DeepToolDefinition,
		phases: readonly ToolPhase[],
	): () => void {
		if (phases.length === 0) {
			throw new Error(`工具 ${definition.name} 必须声明至少一个开放阶段`);
		}
		for (const phase of phases) {
			if (!isToolPhase(phase)) {
				throw new Error(
					`工具 ${definition.name} 的开放阶段不合法：${String(phase)}`,
				);
			}
		}
		createDeepToolRegistry([definition]);
		if (this.toolsByName.has(definition.name)) {
			throw new Error(`工具重复注册：${definition.name}`);
		}
		this.toolsByName.set(definition.name, { plugin, definition, phases });
		return () => {
			if (this.toolsByName.get(definition.name)?.plugin !== plugin) return;
			this.toolsByName.delete(definition.name);
		};
	}

	slots(): Record<string, readonly string[]> {
		const result: Record<string, readonly string[]> = {};
		for (const [name, entries] of this.slotsByName) {
			result[name] = entries.map((entry) => entry.plugin);
		}
		return result;
	}

	slotProviders(name: ContextSlotName): readonly RegisteredSlot[] {
		return this.slotsByName.get(name) ?? [];
	}

	blockType(name: string): BlockTypeDefinition | null {
		return this.blockTypesByName.get(name)?.definition ?? null;
	}

	blockTypes(): readonly string[] {
		return [...this.blockTypesByName.keys()];
	}

	backgroundJob(kind: string): BackgroundJobType | null {
		return this.backgroundJobsByKind.get(kind)?.type ?? null;
	}

	backgroundJobs(): readonly RegisteredBackgroundJob[] {
		return [...this.backgroundJobsByKind.values()];
	}

	tool(name: string): DeepToolDefinition | null {
		return this.toolsByName.get(name)?.definition ?? null;
	}

	/** 某个回合模式开放的工具，按注册顺序。 */
	tools(phase: ToolPhase): readonly DeepToolDefinition[] {
		const result: DeepToolDefinition[] = [];
		for (const entry of this.toolsByName.values()) {
			if (entry.phases.includes(phase)) result.push(entry.definition);
		}
		return result;
	}

	toolNames(): readonly string[] {
		return [...this.toolsByName.keys()];
	}
}
