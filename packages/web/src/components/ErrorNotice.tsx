import { ApiError } from "../api";

/** 所有请求失败都从这里显示：服务端错误码、消息与字段路径。 */
export function ErrorNotice({ error }: { readonly error: unknown }) {
	if (error === null || error === undefined) return null;
	const message =
		error instanceof Error ? error.message : `请求失败：${String(error)}`;
	let field = "";
	if (error instanceof ApiError && typeof error.body.details === "object") {
		const details = error.body.details;
		if (details !== null && "path" in details) {
			const path = details.path;
			if (typeof path === "string" && path.length > 0)
				field = `（字段：${path}）`;
		}
	}
	return (
		<div className="error-notice" role="alert">
			{message}
			{field}
		</div>
	);
}
