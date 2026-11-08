import { BLOCK_TEMPLATE_CONTENT_TOKEN } from "@dramaticer/core/blocks";

/**
 * 沙箱文档的最小 CSP：不加载任何外部资源，只允许模板自己的内联脚本与样式，
 * 图片只允许内联数据和远端图片地址。
 */
export const SANDBOX_CSP =
	"default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'";

export const MIN_SANDBOX_HEIGHT = 1;
export const MAX_SANDBOX_HEIGHT = 10000;
export const MAX_SANDBOX_CHOICE_LENGTH = 2000;

export type SandboxAction =
	| { readonly kind: "zoom" }
	| { readonly kind: "choice"; readonly text: string }
	| { readonly kind: "scroll"; readonly direction: "up" | "down" };

export type SandboxMessage =
	| { readonly kind: "ready" }
	| { readonly kind: "height"; readonly height: number }
	| { readonly kind: "action"; readonly action: SandboxAction };

/** 父页面回给沙箱的确认；只有固定字段。 */
export interface SandboxAck {
	readonly type: "ack";
	readonly action: SandboxAction["kind"];
}

const HEIGHT_SCRIPT = `<script>
(function () {
	var post = function () {
		var root = document.documentElement;
		var body = document.body;
		var height = Math.ceil(
			Math.max(
				root ? root.scrollHeight : 0,
				body ? body.scrollHeight : 0,
				body ? body.offsetHeight : 0
			)
		);
		parent.postMessage({ type: "height", height: height }, "*");
	};
	parent.postMessage({ type: "ready" }, "*");
	window.addEventListener("load", post);
	if (typeof ResizeObserver === "function") {
		new ResizeObserver(post).observe(document.documentElement);
	} else {
		setInterval(post, 250);
	}
})();
</script>`;

export function escapeHtml(text: string): string {
	return text
		.split("&")
		.join("&amp;")
		.split("<")
		.join("&lt;")
		.split(">")
		.join("&gt;")
		.split('"')
		.join("&quot;")
		.split("'")
		.join("&#39;");
}

/** 模板里的占位符替换成转义后的块原文；模板本身由块注册表提供。 */
export function renderBlockTemplate(template: string, content: string): string {
	return template.split(BLOCK_TEMPLATE_CONTENT_TOKEN).join(escapeHtml(content));
}

/** 生成 iframe 的完整 srcdoc；模板 HTML 只出现在沙箱文档里。 */
export function buildSandboxDocument(
	template: string,
	content: string,
): string {
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">
<style>
html, body { margin: 0; padding: 0; background: transparent; color: inherit; font: inherit; }
</style>
</head>
<body>
${renderBlockTemplate(template, content)}
${HEIGHT_SCRIPT}
</body>
</html>`;
}

export function clampSandboxHeight(height: number): number {
	return Math.min(
		MAX_SANDBOX_HEIGHT,
		Math.max(MIN_SANDBOX_HEIGHT, Math.ceil(height)),
	);
}

function parseAction(value: unknown): SandboxAction | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const action = value as {
		readonly kind?: unknown;
		readonly text?: unknown;
		readonly direction?: unknown;
	};
	switch (action.kind) {
		case "zoom":
			return { kind: "zoom" };
		case "choice": {
			if (typeof action.text !== "string") return null;
			const text = action.text.trim();
			if (text.length === 0 || text.length > MAX_SANDBOX_CHOICE_LENGTH) {
				return null;
			}
			return { kind: "choice", text };
		}
		case "scroll":
			if (action.direction === "up" || action.direction === "down") {
				return { kind: "scroll", direction: action.direction };
			}
			return null;
		default:
			return null;
	}
}

/** 白名单：只认 ready、height 与固定类型的 action，其余消息一律忽略。 */
export function parseSandboxMessage(data: unknown): SandboxMessage | null {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return null;
	}
	const message = data as {
		readonly type?: unknown;
		readonly height?: unknown;
		readonly action?: unknown;
	};
	switch (message.type) {
		case "ready":
			return { kind: "ready" };
		case "height": {
			const height = message.height;
			if (typeof height !== "number" || !Number.isFinite(height)) return null;
			if (height < 0 || height > MAX_SANDBOX_HEIGHT) return null;
			return { kind: "height", height: clampSandboxHeight(height) };
		}
		case "action": {
			const action = parseAction(message.action);
			return action === null ? null : { kind: "action", action };
		}
		default:
			return null;
	}
}

export function sandboxAck(message: SandboxMessage): SandboxAck | null {
	return message.kind === "action"
		? { type: "ack", action: message.action.kind }
		: null;
}
