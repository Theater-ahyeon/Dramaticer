/** 把字符串里的 `${VAR}` 替换成环境变量；变量缺失时指出字段路径。 */
export function interpolateEnvRefs(
	value: string,
	env: Readonly<Record<string, string | undefined>>,
	label: string,
): string {
	return value.replace(
		/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
		(_match, name: string) => {
			const resolved = env[name];
			if (resolved === undefined) {
				throw new Error(`${label} 引用的环境变量 ${name} 没有设置`);
			}
			return resolved;
		},
	);
}

/**
 * 解析 `apiKey`：空字符串表示没有密钥，其余必须写成 `${VAR}` 引用，
 * 避免密钥值出现在可提交的配置文件里。
 */
export function parseApiKeyRef(
	value: string,
	env: Readonly<Record<string, string | undefined>>,
	label: string,
): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) return "";
	if (!/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(trimmed)) {
		throw new Error(`${label} 必须写成 \${环境变量名} 的引用`);
	}
	return interpolateEnvRefs(trimmed, env, label);
}
