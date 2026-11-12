import type { EventListener } from "./contracts.js";

export interface EventRegistration {
	readonly plugin: string | null;
	readonly listener: EventListener;
}

/** 按 DESIGN §19.2 的语义分发事件。 */
export class EventBus {
	private readonly hooks = new Map<string, EventRegistration[]>();

	/** 监听器的插件名用于 Trace；直接订阅内核的调用方不提供插件名。 */
	on(
		name: string,
		listener: EventListener,
		plugin: string | null = null,
	): () => void {
		const registration: EventRegistration = { plugin, listener };
		const list = this.hooks.get(name) ?? [];
		list.push(registration);
		this.hooks.set(name, list);
		return () => {
			const current = this.hooks.get(name);
			if (!current) return;
			const index = current.indexOf(registration);
			if (index < 0) return;
			current.splice(index, 1);
			if (current.length === 0) this.hooks.delete(name);
		};
	}

	emit(name: string, ...args: unknown[]): void {
		for (const registration of this.snapshot(name)) {
			registration.listener(...args);
		}
	}

	async parallel(
		name: string,
		...args: unknown[]
	): Promise<readonly unknown[]> {
		return Promise.all(
			this.snapshot(name).map((registration) =>
				Promise.resolve(registration.listener(...args)),
			),
		);
	}

	async serial(name: string, ...args: unknown[]): Promise<readonly unknown[]> {
		const results: unknown[] = [];
		for (const registration of this.snapshot(name)) {
			results.push(await registration.listener(...args));
		}
		return results;
	}

	bail(name: string, ...args: unknown[]): unknown {
		for (const registration of this.snapshot(name)) {
			const result = registration.listener(...args);
			if (result !== null && result !== false && result !== undefined) {
				return result;
			}
		}
		return undefined;
	}

	waterfall<T>(name: string, value: T): T {
		let current = value;
		for (const registration of this.snapshot(name)) {
			current = registration.listener(current) as T;
		}
		return current;
	}

	/** 当前订阅者快照，按注册顺序；回合钩子按插件名逐个计时。 */
	listeners(name: string): readonly EventRegistration[] {
		return this.snapshot(name);
	}

	private snapshot(name: string): readonly EventRegistration[] {
		return [...(this.hooks.get(name) ?? [])];
	}
}
