export const STORY_MEDIA_SLOTS = ["cover", "portrait"] as const;

export type StoryMediaSlot = (typeof STORY_MEDIA_SLOTS)[number];

export function isStoryMediaSlot(value: unknown): value is StoryMediaSlot {
	return (
		typeof value === "string" &&
		(STORY_MEDIA_SLOTS as readonly string[]).includes(value)
	);
}

/** 故事自带的图片：封面按位置只有一张，立绘按人物名称各一张。 */
export interface StoryMediaRecord {
	readonly storyId: string;
	readonly slot: StoryMediaSlot;
	readonly name: string;
	/** 相对媒体目录的路径，分隔符固定为 `/`。 */
	readonly fileName: string;
	readonly mediaType: string;
	readonly byteSize: number;
	readonly createdAt: string;
}

export interface NewStoryMediaInput {
	readonly slot: StoryMediaSlot;
	readonly name: string;
	readonly fileName: string;
	readonly mediaType: string;
	readonly byteSize: number;
	readonly createdAt?: string;
}

export function assertNewStoryMediaInput(input: NewStoryMediaInput): void {
	if (!isStoryMediaSlot(input.slot)) {
		throw new Error(`故事媒体位置不合法：${String(input.slot)}`);
	}
	assertMediaText(input.name, "故事媒体名称");
	assertMediaText(input.fileName, "故事媒体文件名");
	if (
		input.fileName.startsWith("/") ||
		input.fileName.includes("\\") ||
		input.fileName.split("/").some((segment) => segment === "..")
	) {
		throw new Error(
			`故事媒体文件名必须是媒体目录里的相对路径：${input.fileName}`,
		);
	}
	if (!/^image\/[a-z0-9.+-]+$/.test(input.mediaType)) {
		throw new Error(`故事媒体类型不合法：${input.mediaType}`);
	}
	if (!Number.isInteger(input.byteSize) || input.byteSize < 1) {
		throw new Error(`故事媒体字节数必须是正整数：${String(input.byteSize)}`);
	}
	if (input.createdAt !== undefined) {
		assertMediaText(input.createdAt, "故事媒体创建时间");
	}
}

function assertMediaText(
	value: unknown,
	label: string,
): asserts value is string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label}必须是非空字符串`);
	}
}
