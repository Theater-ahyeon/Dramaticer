/**
 * 故事设置里旧版留下的导演组织方式。`mechanisms`（v3 的机制序列）与
 * `bits`（X2 的小品）都已经删除；读到这两个旧值时按 `lines` 运行，
 * 旧故事不需要迁移，也不会因为设置里留着旧字符串而报错。
 */
export const DIRECTOR_ORGANIZATION_KINDS = ["lines"] as const;

export type DirectorOrganizationKind =
	(typeof DIRECTOR_ORGANIZATION_KINDS)[number];

/** 旧版写进故事设置、现在按 `lines` 处理的值。 */
const RETIRED_DIRECTOR_ORGANIZATION_KINDS = ["mechanisms", "bits"] as const;

export const DEFAULT_DIRECTOR_ORGANIZATION: DirectorOrganizationKind = "lines";

export function isDirectorOrganizationKind(
	value: unknown,
): value is DirectorOrganizationKind {
	return value === "lines";
}

export function assertDirectorOrganizationKind(
	value: unknown,
	label = "导演的组织方式",
): DirectorOrganizationKind {
	if (isDirectorOrganizationKind(value)) return value;
	if (
		typeof value === "string" &&
		(RETIRED_DIRECTOR_ORGANIZATION_KINDS as readonly string[]).includes(value)
	) {
		return DEFAULT_DIRECTOR_ORGANIZATION;
	}
	throw new Error(`${label}不合法：${String(value)}`);
}
