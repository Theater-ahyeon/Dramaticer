/** 酒馆助手脚本常用的事件名；值是字符串，脚本也可以监听自定义事件。 */
export const ST_HELPER_TAVERN_EVENTS = {
	MESSAGE_SENT: "message_sent",
	MESSAGE_RECEIVED: "message_received",
	MESSAGE_EDITED: "message_edited",
	MESSAGE_DELETED: "message_deleted",
	MESSAGE_SWIPED: "message_swiped",
	MESSAGE_UPDATED: "message_updated",
	MESSAGE_SWIPE_DELETED: "message_swipe_deleted",
	MESSAGE_REASONING_EDITED: "message_reasoning_edited",
	MESSAGE_REASONING_DELETED: "message_reasoning_deleted",
	MESSAGE_FILE_EMBEDDED: "message_file_embedded",
	MORE_MESSAGES_LOADED: "more_messages_loaded",
	GENERATION_STARTED: "generation_started",
	GENERATION_STOPPED: "generation_stopped",
	GENERATION_ENDED: "generation_ended",
	GENERATION_BEFORE_COMMANDS: "generation_before_commands",
	GENERATION_AFTER_COMMANDS: "generation_after_commands",
	CHAT_CHANGED: "chat_changed",
	CHAT_CREATED: "chat_created",
	CHAT_DELETED: "chat_deleted",
	CHARACTER_EDITED: "character_edited",
	CHARACTER_DELETED: "character_deleted",
	CHARACTER_DUPLICATED: "character_duplicated",
	CHARACTER_RENAMED: "character_renamed",
	GROUP_UPDATED: "group_updated",
	WORLDINFO_UPDATED: "worldinfo_updated",
	SETTINGS_LOADED: "settings_loaded",
	SETTINGS_UPDATED: "settings_updated",
	EXTENSIONS_FIRST_LOAD: "extensions_first_load",
	EXTENSION_SETTINGS_LOADED: "extension_settings_loaded",
	APP_READY: "app_ready",
	USER_MESSAGE_RENDERED: "user_message_rendered",
	CHARACTER_MESSAGE_RENDERED: "character_message_rendered",
	IMPERSONATE_READY: "impersonate_ready",
} as const;

export type StHelperTavernEvent =
	(typeof ST_HELPER_TAVERN_EVENTS)[keyof typeof ST_HELPER_TAVERN_EVENTS];

export type StHelperEventListener = (...args: unknown[]) => unknown;

/** `eventOn` / `eventOnce` 的返回值：调用 `stop()` 取消这一条监听。 */
export interface StHelperEventHandle {
	stop(): void;
}

interface Registration {
	readonly listener: StHelperEventListener;
	readonly once: boolean;
}

/** 脚本自己的事件表；宿主把回合事件转发到 `emit`。 */
export class StHelperEventRegistry {
	readonly #listeners = new Map<string, Registration[]>();

	on(
		type: string,
		listener: StHelperEventListener,
		options: { readonly once?: boolean } = {},
	): StHelperEventHandle {
		const name = assertEventName(type);
		assertListener(listener);
		const registration: Registration = {
			listener,
			once: options.once === true,
		};
		const list = this.#listeners.get(name) ?? [];
		list.push(registration);
		this.#listeners.set(name, list);
		return {
			stop: () => {
				this.#remove(name, registration);
			},
		};
	}

	once(type: string, listener: StHelperEventListener): StHelperEventHandle {
		return this.on(type, listener, { once: true });
	}

	emit(type: string, ...args: unknown[]): void {
		const name = assertEventName(type);
		for (const registration of [...(this.#listeners.get(name) ?? [])]) {
			if (registration.once) this.#remove(name, registration);
			registration.listener(...args);
		}
	}

	remove(type: string, listener: StHelperEventListener): void {
		const name = assertEventName(type);
		const list = this.#listeners.get(name);
		if (list === undefined) return;
		const next = list.filter((entry) => entry.listener !== listener);
		if (next.length === 0) {
			this.#listeners.delete(name);
			return;
		}
		this.#listeners.set(name, next);
	}

	clearEvent(type: string): void {
		this.#listeners.delete(assertEventName(type));
	}

	clearAll(): void {
		this.#listeners.clear();
	}

	listenerCount(type: string): number {
		return this.#listeners.get(assertEventName(type))?.length ?? 0;
	}

	#remove(name: string, registration: Registration): void {
		const list = this.#listeners.get(name);
		if (list === undefined) return;
		const index = list.indexOf(registration);
		if (index < 0) return;
		list.splice(index, 1);
		if (list.length === 0) this.#listeners.delete(name);
	}
}

function assertEventName(type: unknown): string {
	if (typeof type !== "string" || type.length === 0) {
		throw new Error("事件名必须是非空字符串");
	}
	return type;
}

function assertListener(
	listener: unknown,
): asserts listener is StHelperEventListener {
	if (typeof listener !== "function") {
		throw new Error("事件监听器必须是函数");
	}
}
