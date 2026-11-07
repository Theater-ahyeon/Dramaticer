/** 所有 JSON 错误响应共用的错误码。 */
export const API_ERROR_CODES = [
	"bad_request",
	"unauthorized",
	"forbidden",
	"not_found",
	"conflict",
	"payload_too_large",
	"upstream_error",
	"internal",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
	readonly code: ApiErrorCode;
	readonly message: string;
	/** 字段路径或其它可展示的补充信息，结构由具体接口决定。 */
	readonly details?: unknown;
}

/** 服务端的统一错误形状。 */
export interface ApiErrorResponse {
	readonly error: ApiErrorBody;
}
