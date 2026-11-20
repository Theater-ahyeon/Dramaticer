import type { BackgroundHealth, LlmModelRole } from "@dramaticer/core";
import { useEffect, useState } from "react";
import { api } from "../api";
import { MODEL_ROLE_CHOICES } from "../chat/channels-form";
import { TLink, sp } from "./ui";

// 后台失败可见（refactor/03）：后台任务连续因为渠道失败而出错时，故事页顶部告诉
// 玩家「记忆与导演暂停了」以及原因；后台恢复后自动消失，关掉的同一条不再出现。

export type BackgroundHealthView = BackgroundHealth & {
	readonly roles: readonly LlmModelRole[];
};

const POLL_MS = 20_000;

function dismissKey(storyId: string): string {
	return `dramaticer.background-notice.${storyId}`;
}

function signatureOf(health: BackgroundHealthView): string {
	return [health.model, health.channel, health.error].join("|");
}

function readDismissed(storyId: string): string | null {
	try {
		return sessionStorage.getItem(dismissKey(storyId));
	} catch {
		return null;
	}
}

/** 岗位的界面名字；读不到岗位时说「后台」。 */
export function describeRoles(roles: readonly LlmModelRole[]): string {
	const labels = roles.flatMap((role) => {
		const choice = MODEL_ROLE_CHOICES.find((item) => item.value === role);
		return choice === undefined ? [] : [choice.label];
	});
	return labels.length === 0 ? "后台" : labels.join("、");
}

export function BackgroundNotice({
	storyId,
	tick,
}: {
	readonly storyId: string;
	/** 回合结束等时机变化一次，让提示重新读取后台状态。 */
	readonly tick: number;
}) {
	const [health, setHealth] = useState<BackgroundHealthView | null>(null);
	const [dismissed, setDismissed] = useState<string | null>(() =>
		readDismissed(storyId),
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: tick 只用来触发重新读取
	useEffect(() => {
		let active = true;
		const load = () => {
			void api
				.get<BackgroundHealthView>(sp(storyId, "/background/health"))
				.then((value) => {
					if (active) setHealth(value);
				})
				.catch(() => {
					// 读不到状态时不显示提示，不打扰正文。
				});
		};
		load();
		const timer = window.setInterval(load, POLL_MS);
		return () => {
			active = false;
			window.clearInterval(timer);
		};
	}, [storyId, tick]);

	if (health === null || !health.paused) return null;
	const signature = signatureOf(health);
	if (dismissed === signature) return null;
	const where = [
		health.model === null ? null : `模型 ${health.model}`,
		health.channel === null ? null : `渠道 ${health.channel}`,
	]
		.filter((item) => item !== null)
		.join(" · ");
	return (
		<output className="bgnotice">
			<div>
				<b>记忆与导演暂停了</b>
				<p>
					{describeRoles(health.roles)}连续 {health.failures} 次失败
					{where === "" ? "" : `（${where}）`}
					{health.error === null ? "" : `：${health.error}`}
					。正文照常能写，后台恢复后会把落下的楼层补上。
				</p>
			</div>
			<TLink
				className="btn sm"
				to={`/stories/${encodeURIComponent(storyId)}/channels`}
			>
				去渠道设置
			</TLink>
			<button
				type="button"
				className="btn ghost sm"
				onClick={() => {
					try {
						sessionStorage.setItem(dismissKey(storyId), signature);
					} catch {
						// 存不了就只在这一次关掉。
					}
					setDismissed(signature);
				}}
			>
				知道了
			</button>
		</output>
	);
}
