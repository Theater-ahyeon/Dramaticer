/** 导演强度：只铺垫、自然推进、尽快引爆。 */
export const DIRECTOR_INTENSITIES = ["setup", "natural", "detonate"] as const;

export type DirectorIntensity = (typeof DIRECTOR_INTENSITIES)[number];

export function isDirectorIntensity(
	value: unknown,
): value is DirectorIntensity {
	return (
		typeof value === "string" &&
		(DIRECTOR_INTENSITIES as readonly string[]).includes(value)
	);
}

/** 非法强度就地抛错并指出字段名；单轮参数与故事设置的唯一校验口。 */
export function assertDirectorIntensity(
	value: unknown,
	label = "导演强度",
): DirectorIntensity {
	if (!isDirectorIntensity(value)) {
		throw new Error(
			`${label} 必须是 setup、natural 或 detonate，收到 ${String(value)}`,
		);
	}
	return value;
}

/**
 * 单轮强度优先于配置里的值。调用方只传已经校验过的强度，
 * 这里再校验一次，非法值仍然指出字段。
 */
export function resolveDirectorIntensity<
	Config extends { readonly intensity: DirectorIntensity },
>(config: Config, requested: DirectorIntensity | null | undefined): Config {
	if (requested === null || requested === undefined) return config;
	const intensity = assertDirectorIntensity(requested, "单轮导演强度");
	return { ...config, intensity };
}

/** 每一档强度要附带的指令层。 */
export interface DirectorIntensityLayers {
	/** 任何档位都给出的基础层。 */
	readonly setup: string;
	/** natural 与 detonate 追加的层。 */
	readonly natural?: string;
	/** detonate 追加的层。 */
	readonly detonate?: string;
}

/**
 * 按强度只渲染当前档位需要的层：setup 只有基础层，natural 再加一层，
 * detonate 三层全给。空层被跳过，各层按顺序直接拼接。
 */
export function renderByIntensity(
	intensity: DirectorIntensity,
	layers: DirectorIntensityLayers,
): string {
	const parts = [layers.setup];
	if (intensity !== "setup" && layers.natural !== undefined) {
		parts.push(layers.natural);
	}
	if (intensity === "detonate" && layers.detonate !== undefined) {
		parts.push(layers.detonate);
	}
	return parts.join("");
}
