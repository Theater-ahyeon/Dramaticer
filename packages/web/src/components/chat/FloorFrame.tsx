import {
	FLOOR_BRIDGE_CAPABILITIES,
	type FloorBridgeCapability,
} from "@dramaticer/core/sandbox";
import type { FloorRenderView } from "@dramaticer/protocol";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import {
	FLOOR_SANDBOX_ATTRIBUTES,
	MAX_FLOOR_BRIDGE_TEXT,
	buildFloorSandboxDocument,
	parseFloorSandboxMessage,
	readFloorSandboxTheme,
} from "../../chat/floor-sandbox";
import { MIN_SANDBOX_HEIGHT, clampSandboxHeight } from "../../chat/sandbox";
import { onThemeChange } from "../../v4/stage";
import { ImageZoom } from "./ImageZoom";

export interface FloorFrameRejection {
	readonly renderer: string;
	readonly nodeId: string | null;
	readonly kind: "bridge" | "network";
	readonly target: string;
	readonly reason: string;
}

export interface FloorFrameProps {
	readonly storyId: string;
	readonly render: FloorRenderView;
	readonly allowedDomains: readonly string[];
	readonly onSendMessage: (text: string) => void;
	readonly onFillInput: (text: string) => void;
	readonly onRejected: (rejection: FloorFrameRejection) => void;
}

/**
 * 楼层渲染 iframe：只加 allow-scripts，文档的 CSP 按故事的允许名单生成。
 * 交互桥的每个方法都要同时出现在白名单和渲染器声明里；否则拒绝、回传错误、
 * 记入检视器。高度由 iframe 内的观察者上报，父页面同步，避免双滚动条。
 */
export function FloorFrame({
	storyId,
	render,
	allowedDomains,
	onSendMessage,
	onFillInput,
	onRejected,
}: FloorFrameProps) {
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const [height, setHeight] = useState(MIN_SANDBOX_HEIGHT);
	const [theme, setTheme] = useState(readFloorSandboxTheme);
	const [zoomed, setZoomed] = useState<string | null>(null);
	const callbacks = useRef({ onSendMessage, onFillInput, onRejected });
	callbacks.current = { onSendMessage, onFillInput, onRejected };

	useEffect(() => {
		const update = () => {
			const next = readFloorSandboxTheme();
			setTheme(next);
			frameRef.current?.contentWindow?.postMessage(
				{ type: "floor:theme", theme: next },
				"*",
			);
		};
		const stop = onThemeChange(update);
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		media.addEventListener("change", update);
		return () => {
			stop();
			media.removeEventListener("change", update);
		};
	}, []);

	const renderer = render.renderer ?? "未命名渲染器";
	const permissions = render.permissions;
	const nodeId = render.nodeId;

	useEffect(() => {
		const frame = frameRef.current;
		if (frame === null) return;
		const declared = new Set<FloorBridgeCapability>(permissions);
		const known = new Set<string>(FLOOR_BRIDGE_CAPABILITIES);
		const record = (
			kind: "bridge" | "network",
			target: string,
			reason: string,
		) => {
			callbacks.current.onRejected({
				renderer,
				nodeId,
				kind,
				target,
				reason,
			});
		};
		const reply = (
			id: number,
			ok: boolean,
			value?: unknown,
			error?: string,
		) => {
			frame.contentWindow?.postMessage(
				ok
					? { type: "floor:bridge-result", id, ok: true, value }
					: { type: "floor:bridge-result", id, ok: false, error },
				"*",
			);
		};
		const onMessage = (event: MessageEvent): void => {
			if (event.source !== frame.contentWindow) return;
			// 没有 allow-same-origin 的 srcdoc iframe 来源是 "null"。
			if (event.origin !== "null") return;
			const message = parseFloorSandboxMessage(event.data);
			if (message === null) return;
			if (message.kind === "height") {
				setHeight(clampSandboxHeight(message.height));
				return;
			}
			if (message.kind === "violation") {
				record(message.rejection, message.target, message.reason);
				return;
			}
			if (message.kind !== "bridge") return;
			const { id, method, args } = message;
			if (!known.has(method)) {
				const reason = `未知的交互桥方法：${method}`;
				reply(id, false, undefined, reason);
				record("bridge", method, reason);
				return;
			}
			if (!declared.has(method as FloorBridgeCapability)) {
				const reason = `渲染器没有声明 ${method} 权限`;
				reply(id, false, undefined, reason);
				record("bridge", method, reason);
				return;
			}
			void runBridge(method as FloorBridgeCapability, args, {
				storyId,
				nodeId,
				renderer,
				onSendMessage: callbacks.current.onSendMessage,
				onFillInput: callbacks.current.onFillInput,
				openImage: setZoomed,
			}).then(
				(value) => reply(id, true, value),
				(error: unknown) => {
					const reason = error instanceof Error ? error.message : String(error);
					reply(id, false, undefined, reason);
					record("bridge", method, reason);
				},
			);
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [storyId, nodeId, renderer, permissions]);

	return (
		<div className="floor-sandbox">
			<iframe
				key={`${render.nodeId}:${allowedDomains.join(",")}`}
				ref={frameRef}
				title={`楼层渲染：${render.name ?? renderer}`}
				sandbox={FLOOR_SANDBOX_ATTRIBUTES}
				srcDoc={buildFloorSandboxDocument({
					html: render.html ?? "",
					script: render.script,
					style: render.style,
					allowedDomains,
					theme,
					permissions,
				})}
				style={{ height: `${height}px` }}
			/>
			{zoomed === null ? null : (
				<ImageZoom src={zoomed} onClose={() => setZoomed(null)} />
			)}
		</div>
	);
}

async function runBridge(
	method: FloorBridgeCapability,
	args: readonly unknown[],
	context: {
		readonly storyId: string;
		readonly nodeId: string;
		readonly renderer: string;
		readonly onSendMessage: (text: string) => void;
		readonly onFillInput: (text: string) => void;
		readonly openImage: (src: string) => void;
	},
): Promise<unknown> {
	switch (method) {
		case "sendMessage": {
			const text = readBridgeText(args[0]);
			context.onSendMessage(text);
			return null;
		}
		case "fillInput": {
			const text = readBridgeText(args[0]);
			context.onFillInput(text);
			return null;
		}
		case "readState": {
			const path = readStatePath(args[0]);
			const view = await api.readSandboxState(
				context.storyId,
				context.nodeId,
				path,
			);
			return view.value;
		}
		case "writeState": {
			const write = readStateWrite(args[0]);
			const result = await api.writeSandboxState(context.storyId, {
				renderer: context.renderer,
				nodeId: context.nodeId,
				write,
			});
			return result;
		}
		case "openImage": {
			context.openImage(readImageSource(args[0]));
			return null;
		}
	}
}

function readBridgeText(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("参数必须是字符串");
	}
	const text = value.trim();
	if (text.length === 0) throw new Error("参数不能为空");
	if (text.length > MAX_FLOOR_BRIDGE_TEXT) {
		throw new Error(`参数不能超过 ${MAX_FLOOR_BRIDGE_TEXT} 个字符`);
	}
	return text;
}

function readStatePath(value: unknown): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > 20) {
		throw new Error("状态路径必须是最多 20 段的数组");
	}
	return value.map((segment, index) => {
		if (typeof segment !== "string" || segment.length === 0) {
			throw new Error(`状态路径第 ${index + 1} 段必须是非空字符串`);
		}
		return segment;
	});
}

function readStateWrite(value: unknown): {
	readonly path: readonly string[];
	readonly op: "set" | "delete";
	readonly value?: unknown;
} {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("写入必须是一个对象");
	}
	const write = value as {
		readonly path?: unknown;
		readonly op?: unknown;
		readonly value?: unknown;
	};
	const path = readStatePath(write.path);
	if (write.op !== "set" && write.op !== "delete") {
		throw new Error("写入的 op 只能是 set 或 delete");
	}
	if (write.op === "set") {
		return { path, op: "set", value: write.value ?? null };
	}
	return { path, op: "delete" };
}

function readImageSource(value: unknown): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 2_000) {
		throw new Error("图片地址必须是长度不超过 2000 的字符串");
	}
	if (!/^(https?:\/\/|data:image\/|blob:|\/)/.test(value)) {
		throw new Error("图片地址只接受 http、data、blob 或站内路径");
	}
	return value;
}
