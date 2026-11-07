import { normalizeRetrievalText } from "./retrieval/chunk-index.js";

export type EntityKind =
	| "character"
	| "location"
	| "item"
	| "faction"
	| "lore"
	| "unknown";

export const ENTITY_KINDS: readonly EntityKind[] = [
	"character",
	"location",
	"item",
	"faction",
	"lore",
	"unknown",
];

export function isEntityKind(value: unknown): value is EntityKind {
	return (
		typeof value === "string" &&
		(ENTITY_KINDS as readonly string[]).includes(value)
	);
}

/**
 * 别名匹配共用的规范化：NFKC、去掉标点符号与空白、再折叠大小写。
 * 名称与别名必须由同一个函数处理，否则全角、空格和标点会让同一个实体对不上。
 */
export function normalizeEntityName(name: string): string {
	if (typeof name !== "string") {
		throw new Error("实体名称必须是字符串");
	}
	return normalizeRetrievalText(name).toLowerCase();
}

export interface Entity {
	readonly id: string;
	readonly storyId: string;
	readonly kind: EntityKind;
	readonly name: string;
	readonly description: string;
	/** 实体来自哪里，例如角色卡、世界书或手工录入 */
	readonly source: string;
	readonly createdAt: string;
	/** 名称本身也是别名；按首次加入的顺序排列 */
	readonly aliases: readonly string[];
}

export interface NewEntityInput {
	readonly id?: string;
	readonly storyId: string;
	readonly kind: EntityKind;
	readonly name: string;
	readonly description?: string;
	readonly source: string;
	readonly aliases?: readonly string[];
	readonly createdAt?: string;
}
