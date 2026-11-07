/** JSON 对象的最小类型守卫；解析外部数据时统一从这里收窄。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
