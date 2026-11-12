import { defaultBlockTypeRegistry } from "../plugins/block-types.js";
import {
	type BlockTypeDefinition,
	type BlockTypeRegistry,
	type ParsedBlock,
	type ParsedContent,
	createBlockTypeRegistry,
} from "./types.js";

export interface BlockParserOptions {
	/** 自定义块类型；与 `registry` 只能二选一。 */
	readonly types?: readonly BlockTypeDefinition[];
	readonly registry?: BlockTypeRegistry;
}

interface MutableText {
	kind: "text";
	text: string;
}

interface MutableBlock {
	kind: "block";
	name: string;
	type: BlockTypeDefinition;
	complete: boolean;
	content: MutableContent[];
}

type MutableContent = MutableText | MutableBlock;

/** 增量解析标签块。推入的文本可以切在任意位置，包括标签中间。 */
export class BlockParser {
	readonly #registry: BlockTypeRegistry;
	readonly #tags: readonly string[];
	readonly #root: MutableContent[] = [];
	readonly #stack: MutableBlock[] = [];
	#pending = "";
	#raw = "";
	#finished = false;

	constructor(options: BlockParserOptions = {}) {
		if (options.types !== undefined && options.registry !== undefined) {
			throw new Error("块解析器不能同时指定 types 与 registry");
		}
		this.#registry =
			options.registry ??
			(options.types
				? createBlockTypeRegistry(options.types)
				: defaultBlockTypeRegistry());
		this.#tags = this.#registry.names
			.flatMap((name) => [`<${name}>`, `</${name}>`])
			.sort((left, right) => right.length - left.length);
	}

	/** 已经推入的全部原文，包括尚未确定的标签前缀。 */
	get raw(): string {
		return this.#raw;
	}

	push(chunk: string): void {
		if (this.#finished) {
			throw new Error("块解析器已经结束，不能再推入文本");
		}
		if (typeof chunk !== "string") {
			throw new TypeError("推入块解析器的内容必须是字符串");
		}
		this.#raw += chunk;
		const input = this.#pending + chunk;
		this.#pending = "";
		this.#scan(input);
	}

	/**
	 * 当前解析结果。末尾正好切在标签中间的字符还不确定，不会出现在结果里。
	 * 返回的是快照，后续 push 不会修改它。
	 */
	snapshot(): readonly ParsedContent[] {
		return cloneContent(this.#root);
	}

	/** 结束输入：把未完成的标签前缀当作普通文本，未闭合的块保留为 complete=false。 */
	finish(): readonly ParsedContent[] {
		if (!this.#finished) {
			if (this.#pending.length > 0) {
				this.#appendText(this.#pending);
				this.#pending = "";
			}
			this.#finished = true;
		}
		return this.snapshot();
	}

	#scan(input: string): void {
		let index = 0;
		while (index < input.length) {
			if (input[index] !== "<") {
				const next = input.indexOf("<", index);
				if (next === -1) {
					this.#appendText(input.slice(index));
					return;
				}
				this.#appendText(input.slice(index, next));
				index = next;
				continue;
			}
			const rest = input.slice(index);
			const tag = this.#matchTag(rest);
			if (tag !== null) {
				this.#handleTag(tag);
				index += tag.length;
				continue;
			}
			if (this.#isTagPrefix(rest)) {
				this.#pending = rest;
				return;
			}
			this.#appendText("<");
			index += 1;
		}
	}

	#matchTag(rest: string): string | null {
		for (const tag of this.#tags) {
			if (rest.startsWith(tag)) return tag;
		}
		return null;
	}

	#isTagPrefix(rest: string): boolean {
		for (const tag of this.#tags) {
			if (rest.length < tag.length && tag.startsWith(rest)) return true;
		}
		return false;
	}

	#handleTag(tag: string): void {
		if (tag.startsWith("</")) {
			const name = tag.slice(2, -1);
			const top = this.#stack.at(-1);
			if (top !== undefined && top.name === name) {
				top.complete = true;
				this.#stack.pop();
			} else {
				// 不配对的闭合标签保留为原文，避免把内层块错误地结束掉。
				this.#appendText(tag);
			}
			return;
		}
		const name = tag.slice(1, -1);
		const type = this.#registry.get(name);
		if (type === null) {
			this.#appendText(tag);
			return;
		}
		const block: MutableBlock = {
			kind: "block",
			name,
			type,
			complete: false,
			content: [],
		};
		this.#children().push(block);
		this.#stack.push(block);
	}

	#children(): MutableContent[] {
		const top = this.#stack.at(-1);
		return top === undefined ? this.#root : top.content;
	}

	#appendText(text: string): void {
		if (text.length === 0) return;
		const children = this.#children();
		const last = children.at(-1);
		if (last !== undefined && last.kind === "text") {
			last.text += text;
			return;
		}
		children.push({ kind: "text", text });
	}
}

/** 一次性解析完整文本；内部与增量解析走同一条路径。 */
export function parseBlocks(
	text: string,
	options: BlockParserOptions = {},
): readonly ParsedContent[] {
	const parser = new BlockParser(options);
	parser.push(text);
	return parser.finish();
}

function cloneContent(items: readonly MutableContent[]): ParsedContent[] {
	return items.map((item) =>
		item.kind === "text" ? { kind: "text", text: item.text } : cloneBlock(item),
	);
}

function cloneBlock(block: MutableBlock): ParsedBlock {
	const content = cloneContent(block.content);
	return {
		kind: "block",
		name: block.name,
		type: block.type,
		complete: block.complete,
		content,
		raw: content
			.map((item) => (item.kind === "text" ? item.text : item.raw))
			.join(""),
	};
}
