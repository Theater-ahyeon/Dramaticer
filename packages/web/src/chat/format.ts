/** 楼层时间按本地时区显示到分钟；不是今年的时间带上年份；解析不了就原样显示。 */
export function formatFloorTime(createdAt: string, now = new Date()): string {
	const date = new Date(createdAt);
	if (Number.isNaN(date.getTime())) return createdAt;
	const pad = (value: number) => String(value).padStart(2, "0");
	const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	const hourMinute = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
	// 跨年时只写月日会和今年的同名日期分不清，补上年份。
	const day =
		date.getFullYear() === now.getFullYear()
			? monthDay
			: `${date.getFullYear()}-${monthDay}`;
	return `${day} ${hourMinute}`;
}
