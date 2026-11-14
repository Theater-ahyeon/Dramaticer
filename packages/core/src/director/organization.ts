import { DEFAULT_MECHANISM_KERNEL } from "../plugins/mechanisms.js";
import type { StoryStore } from "../store/story-store.js";
import { evaluateDirector } from "./evaluate.js";
import type {
	DirectorConfig,
	DirectorMechanism,
	DirectorSuggestion,
} from "./types.js";

/** 导演的组织方式；对比实验 X2 的两个候选。 */
export const DIRECTOR_ORGANIZATION_KINDS = ["mechanisms", "bits"] as const;

export type DirectorOrganizationKind =
	(typeof DIRECTOR_ORGANIZATION_KINDS)[number];

export const DEFAULT_DIRECTOR_ORGANIZATION: DirectorOrganizationKind =
	"mechanisms";

export function isDirectorOrganizationKind(
	value: unknown,
): value is DirectorOrganizationKind {
	return (
		typeof value === "string" &&
		(DIRECTOR_ORGANIZATION_KINDS as readonly string[]).includes(value)
	);
}

export function assertDirectorOrganizationKind(
	value: unknown,
	label = "导演的组织方式",
): DirectorOrganizationKind {
	if (!isDirectorOrganizationKind(value)) {
		throw new Error(`${label}不合法：${String(value)}`);
	}
	return value;
}

export interface DirectorEngineInput {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly nodeId: string;
	readonly config: DirectorConfig;
}

/**
 * 导演的统一评估接口。组织方式决定内部怎么选出一条建议，
 * 调用方只传种类，不接触具体机制或小品。
 */
export interface DirectorEngine {
	readonly kind: DirectorOrganizationKind;
	/** 机制型引擎的机制名，用于上下文包指纹；其他组织形式为 null。 */
	readonly mechanismNames: readonly string[] | null;
	/** 评估并写入本楼层的决策记录；导演关闭时返回 null 且不写记录。 */
	evaluate(input: DirectorEngineInput): DirectorSuggestion | null;
}

export interface CreateDirectorEngineOptions {
	/** 机制型引擎使用的机制序列；不设置时使用内核里的内置机制。 */
	readonly mechanisms?: readonly DirectorMechanism[];
}

/** 按组织方式创建导演引擎；尚未实现的候选直接失败。 */
export function createDirectorEngine(
	kind: DirectorOrganizationKind = DEFAULT_DIRECTOR_ORGANIZATION,
	options: CreateDirectorEngineOptions = {},
): DirectorEngine {
	assertDirectorOrganizationKind(kind);
	switch (kind) {
		case "mechanisms": {
			const mechanisms =
				options.mechanisms ?? DEFAULT_MECHANISM_KERNEL.mechanisms();
			return {
				kind,
				mechanismNames: mechanisms.map((mechanism) => mechanism.name),
				evaluate(input) {
					return evaluateDirector({
						store: input.store,
						storyId: input.storyId,
						nodeId: input.nodeId,
						config: input.config,
						mechanisms,
					});
				},
			};
		}
		case "bits":
			throw new Error("导演组织方式 bits 尚未实现（X2.b）");
	}
}
