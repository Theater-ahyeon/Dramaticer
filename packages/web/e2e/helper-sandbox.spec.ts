import { expect, test } from "@playwright/test";
import { buildStHelperSandboxDocument } from "../src/chat/helper-sandbox";

interface SandboxProbeWindow {
	readonly __results: Array<Record<string, unknown>>;
	__start(content: string, timeoutMs?: number): void;
}

const SANDBOX_DOCUMENT = buildStHelperSandboxDocument({
	functions: ["getVariable"],
	events: {},
});

const HOST_PAGE = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>沙箱宿主</title></head>
<body>
<script>
const SANDBOX = ${JSON.stringify(SANDBOX_DOCUMENT).replaceAll("<", "\\u003c")};
window.__results = [];
window.__pending = null;
window.__timer = null;
window.__frame = null;
window.__execution = 0;

window.__start = function (content, timeoutMs) {
	if (window.__frame !== null) {
		window.__frame.remove();
		window.__frame = null;
	}
	const execution = "exec-" + (++window.__execution);
	window.__pending = { content: content, timeoutMs: timeoutMs, execution: execution };
	const frame = document.createElement("iframe");
	frame.setAttribute("sandbox", "allow-scripts");
	frame.srcdoc = SANDBOX;
	window.__frame = frame;
	document.body.appendChild(frame);
};

window.addEventListener("message", function (event) {
	const frame = window.__frame;
	if (frame === null || event.source !== frame.contentWindow) return;
	const data = event.data;
	if (!data || typeof data !== "object") return;
	if (data.type === "st-helper:ready") {
		const pending = window.__pending;
		frame.contentWindow.postMessage({
			type: "st-helper:run",
			execution: pending.execution,
			script: "sandbox-script",
			content: pending.content,
			functions: ["getVariable"],
			events: {},
		}, "*");
		if (pending.timeoutMs) {
			window.__timer = setTimeout(function () {
				window.__results.push({ type: "timeout", execution: pending.execution });
				frame.remove();
				window.__frame = null;
			}, pending.timeoutMs);
		}
		return;
	}
	if (data.type === "st-helper:call") {
		frame.contentWindow.postMessage({
			type: "st-helper:result",
			id: data.id,
			ok: true,
			value: 3,
		}, "*");
		return;
	}
	if (data.type === "st-helper:done") {
		clearTimeout(window.__timer);
		window.__results.push(data);
		return;
	}
	if (data.type === "escape") {
		window.__results.push(data);
	}
});
</script>
</body>
</html>`;

const ESCAPE_SCRIPT = `
const attempts = {};
function check(name, run) {
	try {
		attempts[name] = run();
	} catch (error) {
		attempts[name] = "blocked";
	}
}
check("parentDocument", () => typeof parent.document);
check("topLocation", () => parent.location.href);
check("localStorage", () => localStorage.length);
check("indexedDB", () => indexedDB.open("probe") && "opened");
check("tavernHelper", () => Object.keys(window.TavernHelper).sort().join(","));
try {
	await fetch("http://127.0.0.1:4517/api/health");
	attempts.fetch = "allowed";
} catch (error) {
	attempts.fetch = "blocked";
}
const value = await getVariable("hp");
parent.postMessage({ type: "escape", attempts: attempts, value: value }, "*");
`;

test("沙箱脚本只能通过宿主 API 读写，读不到父页面、存储与网络", async ({
	page,
}) => {
	await page.setContent(HOST_PAGE);
	await page.evaluate((content) => {
		const probe = window as unknown as SandboxProbeWindow;
		probe.__start(content);
	}, ESCAPE_SCRIPT);
	await page.waitForFunction(() => {
		const probe = window as unknown as SandboxProbeWindow;
		return probe.__results.some((entry) => entry.type === "escape");
	});
	const result = await page.evaluate(() => {
		const probe = window as unknown as SandboxProbeWindow;
		return probe.__results.find((entry) => entry.type === "escape");
	});
	expect(result).toMatchObject({
		attempts: {
			parentDocument: "blocked",
			topLocation: "blocked",
			localStorage: "blocked",
			indexedDB: "blocked",
			fetch: "blocked",
			tavernHelper: "getVariable,tavern_events",
		},
		value: 3,
	});
	await page.waitForFunction(() => {
		const probe = window as unknown as SandboxProbeWindow;
		return probe.__results.some((entry) => entry.type === "st-helper:done");
	});
});

test("脚本超时被终止后新 iframe 仍能执行", async ({ page }) => {
	await page.setContent(HOST_PAGE);
	await page.evaluate((content) => {
		const probe = window as unknown as SandboxProbeWindow;
		probe.__start(content, 200);
	}, "await new Promise(function (resolve) { setTimeout(resolve, 60000); });");
	await page.waitForFunction(() => {
		const probe = window as unknown as SandboxProbeWindow;
		return probe.__results.some((entry) => entry.type === "timeout");
	});
	await page.evaluate(() => {
		const probe = window as unknown as SandboxProbeWindow;
		probe.__start('parent.postMessage({ type: "escape", second: true }, "*");');
	});
	await page.waitForFunction(() => {
		const probe = window as unknown as SandboxProbeWindow;
		return probe.__results.some(
			(entry) => entry.type === "escape" && entry.second === true,
		);
	});
});
