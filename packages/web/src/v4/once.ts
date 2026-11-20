// 本轮临时开关（DESIGN §22）：只随下一次发送带上，发完就清空；不改功能页的设置。

/** 输入台「本轮」里能临时切换的开关：都影响这一轮怎么写，且已经接通运行时。 */
export const ONCE_SWITCH_IDS = [
	"reunion",
	"search",
	"knows",
	"rules",
	"tools",
	"style",
] as const;

export type OnceSwitchId = (typeof ONCE_SWITCH_IDS)[number];
export type OnceOverrides = Readonly<Partial<Record<OnceSwitchId, boolean>>>;

/** 本轮实际取值：有临时值用临时值，否则用功能页的值。 */
export function onceValue(
	once: OnceOverrides,
	id: OnceSwitchId,
	storyValue: boolean,
): boolean {
	return once[id] ?? storyValue;
}

/** 点一下翻转本轮取值；翻回和功能页一样时去掉临时值，不留下无意义的覆盖。 */
export function toggleOnce(
	once: OnceOverrides,
	id: OnceSwitchId,
	storyValue: boolean,
): OnceOverrides {
	const next = !onceValue(once, id, storyValue);
	const { [id]: _dropped, ...rest } = once;
	return next === storyValue ? rest : { ...rest, [id]: next };
}
