import {
	type BlockTypeDefinition,
	type ContextSlotName,
	type ContextSlotProvider,
	type DirectorMechanism,
	isContextSlotName,
} from "@dramaticer/core";
import { createBlockTypeRegistry } from "@dramaticer/core/blocks";

interface RegisteredSlot {
	readonly plugin: string;
	readonly provider: ContextSlotProvider;
}

interface RegisteredMechanism {
	readonly plugin: string;
	readonly mechanism: DirectorMechanism;
}

interface RegisteredBlockType {
	readonly plugin: string;
	readonly definition: BlockTypeDefinition;
}

/** 扩展点注册表；每次注册返回一个幂等的撤销函数。 */
export class ExtensionRegistry {
	private readonly slotsByName = new Map<ContextSlotName, RegisteredSlot[]>();
	private readonly mechanismsByName = new Map<string, RegisteredMechanism>();
	private readonly blockTypesByName = new Map<string, RegisteredBlockType>();

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

	addMechanism(plugin: string, mechanism: DirectorMechanism): () => void {
		if (mechanism.name.length === 0) {
			throw new Error("Director 机制名不能为空");
		}
		if (typeof mechanism.evaluate !== "function") {
			throw new Error(`Director 机制 ${mechanism.name} 必须有 evaluate 方法`);
		}
		if (this.mechanismsByName.has(mechanism.name)) {
			throw new Error(`Director 机制重复注册：${mechanism.name}`);
		}
		this.mechanismsByName.set(mechanism.name, { plugin, mechanism });
		return () => {
			if (this.mechanismsByName.get(mechanism.name)?.plugin !== plugin) return;
			this.mechanismsByName.delete(mechanism.name);
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

	mechanisms(): readonly RegisteredMechanism[] {
		return [...this.mechanismsByName.values()];
	}

	blockType(name: string): BlockTypeDefinition | null {
		return this.blockTypesByName.get(name)?.definition ?? null;
	}

	blockTypes(): readonly string[] {
		return [...this.blockTypesByName.keys()];
	}
}
