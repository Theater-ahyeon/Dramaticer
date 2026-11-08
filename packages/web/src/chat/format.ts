/** 楼层时间按本地时区显示到分钟；解析不了就原样显示。 */
export function formatFloorTime(createdAt: string): string {
	const date = new Date(createdAt);
	if (Number.isNaN(date.getTime())) return createdAt;
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hour = String(date.getHours()).padStart(2, "0");
	const minute = String(date.getMinutes()).padStart(2, "0");
	return `${month}-${day} ${hour}:${minute}`;
}
