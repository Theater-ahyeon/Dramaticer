import {
	IMAGE_SHOTS,
	type ImagePromptRequest,
	MAX_IMAGE_PROMPT_CHARACTERS,
	isImageShot,
} from "./prompt.js";

export const MAX_IMAGE_SCENE_CHARS = 500;

const REQUEST_KEYS = ["characters", "scene", "shot", "mood"] as const;

function requireText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value.trim();
}

/**
 * 校验 `illustrate` 的参数形状。工具注册、回合处理与数据库读回共用这一处，
 * 未知键、超长场景、过多人物与非法镜头都直接拒绝。
 */
export function validateImagePromptRequest(
	value: unknown,
	label = "生图请求",
): ImagePromptRequest {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} 必须是 JSON 对象`);
	}
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (!(REQUEST_KEYS as readonly string[]).includes(key)) {
			throw new Error(`${label} 不接受字段 ${key}`);
		}
	}
	const scene = requireText(record.scene, `${label}.scene`);
	if (scene.length > MAX_IMAGE_SCENE_CHARS) {
		throw new Error(
			`${label}.scene 最多 ${MAX_IMAGE_SCENE_CHARS} 个字符，实际为 ${scene.length} 个`,
		);
	}
	const characters: string[] = [];
	const seen = new Set<string>();
	if (record.characters !== undefined) {
		if (!Array.isArray(record.characters)) {
			throw new Error(`${label}.characters 必须是字符串数组`);
		}
		if (record.characters.length > MAX_IMAGE_PROMPT_CHARACTERS) {
			throw new Error(
				`${label}.characters 最多 ${MAX_IMAGE_PROMPT_CHARACTERS} 个`,
			);
		}
		for (const [index, item] of record.characters.entries()) {
			const name = requireText(item, `${label}.characters[${index}]`);
			if (seen.has(name)) continue;
			seen.add(name);
			characters.push(name);
		}
	}
	let shot: (typeof IMAGE_SHOTS)[number] | undefined;
	if (record.shot !== undefined) {
		if (!isImageShot(record.shot)) {
			throw new Error(`${label}.shot 必须是 ${IMAGE_SHOTS.join("、")} 之一`);
		}
		shot = record.shot;
	}
	const mood =
		record.mood === undefined
			? undefined
			: requireText(record.mood, `${label}.mood`);
	return {
		...(characters.length === 0 ? {} : { characters }),
		scene,
		...(shot === undefined ? {} : { shot }),
		...(mood === undefined ? {} : { mood }),
	};
}
