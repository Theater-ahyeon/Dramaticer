import { IMAGE_BLOCK_TEMPLATE } from "@dramaticer/core/blocks";
import { describe, expect, it } from "vitest";
import {
	MAX_SANDBOX_HEIGHT,
	buildSandboxDocument,
	escapeHtml,
	parseSandboxMessage,
	renderBlockTemplate,
	sandboxAck,
} from "../src/chat/sandbox";

describe("沙箱文档", () => {
	it("模板里的占位符全部换成转义后的块原文", () => {
		expect(
			renderBlockTemplate(
				"<p>{{content}}</p><p>{{content}}</p>",
				"<script>\"x\" & 'y'</script>",
			),
		).toBe(
			"<p>&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;</p><p>&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;</p>",
		);
	});

	it("转义不会重复处理替换回来的字符", () => {
		expect(escapeHtml("&lt;")).toBe("&amp;lt;");
	});

	it("srcdoc 带最小 CSP 与高度脚本", () => {
		const document = buildSandboxDocument("<div>块</div>", "内容");
		expect(document).toContain("Content-Security-Policy");
		expect(document).toContain("default-src 'none'");
		expect(document).toContain("script-src 'unsafe-inline'");
		expect(document).toContain('type: "height"');
		expect(document).toContain("<div>块</div>");
		expect(document).not.toContain("allow-same-origin");
	});

	it("图片文档把地址写进图片模板", () => {
		const document = buildSandboxDocument(
			IMAGE_BLOCK_TEMPLATE,
			"data:image/png;base64,AAA",
		);
		expect(document).toContain('src="data:image/png;base64,AAA"');
		expect(document).toContain('type: "action"');
		expect(document).toContain('kind: "zoom"');
	});
});

describe("沙箱消息白名单", () => {
	it("接受 ready、height 与固定类型的 action", () => {
		expect(parseSandboxMessage({ type: "ready" })).toEqual({ kind: "ready" });
		expect(parseSandboxMessage({ type: "height", height: 120.2 })).toEqual({
			kind: "height",
			height: 121,
		});
		expect(
			parseSandboxMessage({
				type: "action",
				action: { kind: "choice", text: " 点火把 " },
			}),
		).toEqual({ kind: "action", action: { kind: "choice", text: "点火把" } });
		expect(
			parseSandboxMessage({
				type: "action",
				action: { kind: "scroll", direction: "down" },
			}),
		).toEqual({
			kind: "action",
			action: { kind: "scroll", direction: "down" },
		});
		expect(
			parseSandboxMessage({ type: "action", action: { kind: "zoom" } }),
		).toEqual({ kind: "action", action: { kind: "zoom" } });
	});

	it("高度限制在上下界内", () => {
		expect(parseSandboxMessage({ type: "height", height: 0 })).toEqual({
			kind: "height",
			height: 1,
		});
		expect(parseSandboxMessage({ type: "height", height: -1 })).toBeNull();
		expect(
			parseSandboxMessage({ type: "height", height: MAX_SANDBOX_HEIGHT + 1 }),
		).toBeNull();
		expect(parseSandboxMessage({ type: "height", height: "120" })).toBeNull();
	});

	it("非法消息一律忽略", () => {
		expect(parseSandboxMessage(null)).toBeNull();
		expect(parseSandboxMessage("ready")).toBeNull();
		expect(parseSandboxMessage([])).toBeNull();
		expect(parseSandboxMessage({ type: "resize", height: 10 })).toBeNull();
		expect(
			parseSandboxMessage({ type: "action", action: { kind: "eval" } }),
		).toBeNull();
		expect(
			parseSandboxMessage({
				type: "action",
				action: { kind: "choice", text: "   " },
			}),
		).toBeNull();
		expect(
			parseSandboxMessage({
				type: "action",
				action: { kind: "scroll", direction: "left" },
			}),
		).toBeNull();
	});

	it("父页面只回发固定字段的确认", () => {
		expect(sandboxAck({ kind: "ready" })).toBeNull();
		expect(sandboxAck({ kind: "height", height: 40 })).toBeNull();
		expect(
			sandboxAck({ kind: "action", action: { kind: "choice", text: "走" } }),
		).toEqual({ type: "ack", action: "choice" });
	});
});
