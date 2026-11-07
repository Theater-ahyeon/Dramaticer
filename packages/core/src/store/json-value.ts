function assertJsonValueInner(
	value: unknown,
	path: string,
	seen: Set<object>,
): void {
	if (value === null) return;
	switch (typeof value) {
		case "string":
		case "boolean":
			return;
		case "number":
			if (!Number.isFinite(value)) {
				throw new Error(`${path} 不是有限数字`);
			}
			return;
		case "object": {
			if (seen.has(value)) {
				throw new Error(`${path} 存在循环引用`);
			}
			seen.add(value);
			if (Array.isArray(value)) {
				for (let index = 0; index < value.length; index += 1) {
					assertJsonValueInner(value[index], `${path}[${index}]`, seen);
				}
			} else {
				const prototype = Object.getPrototypeOf(value);
				if (prototype !== Object.prototype && prototype !== null) {
					throw new Error(`${path} 不是纯 JSON 对象`);
				}
				for (const [key, child] of Object.entries(value)) {
					assertJsonValueInner(child, `${path}.${key}`, seen);
				}
			}
			seen.delete(value);
			return;
		}
		default:
			throw new Error(`${path} 不是 JSON 值（${typeof value}）`);
	}
}

function assertJsonValue(value: unknown, path: string): void {
	assertJsonValueInner(value, path, new Set());
}

export function serializeJsonValue(value: unknown, path: string): string {
	assertJsonValue(value, path);
	return JSON.stringify(value);
}
