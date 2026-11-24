import { useEffect, useState } from "react";
import { api } from "../api";
import { errorText, useLoad, useToast } from "./ui";

/**
 * 开玩之前的开场：多条开场白左右切换，后台备好的开局候选以卡片列出，点一下替换开场。
 * 玩家一开口（服务端 `atOpening` 变 false）整块消失。
 */
export function Opening({
	storyId,
	tick,
	busy,
	onChanged,
}: {
	readonly storyId: string;
	readonly tick: number;
	readonly busy: boolean;
	readonly onChanged: () => void;
}) {
	const toast = useToast();
	const greetings = useLoad(() => api.getGreetings(storyId), [storyId, tick]);
	const openings = useLoad(
		() => api.getOpenings(storyId, "pending"),
		[storyId, tick],
	);
	const [working, setWorking] = useState(false);
	// 候选在后台生成：刚导卡或点了换一批时，没出来之前隔一会儿再看一次。
	const [waitingSince, setWaitingSince] = useState<number | null>(null);
	const [manual, setManual] = useState(false);
	const pending = openings.data?.candidates ?? [];
	const pendingCount = pending.length;

	useEffect(() => {
		if (waitingSince === null) return;
		const timer = window.setInterval(() => {
			if (Date.now() - waitingSince > 60_000) {
				setWaitingSince(null);
				setManual(false);
			} else openings.reload();
		}, 1500);
		return () => window.clearInterval(timer);
	}, [waitingSince, openings.reload]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在候选数量变化时判断是否等到了
	useEffect(() => {
		if (waitingSince !== null && pendingCount > 0) {
			setWaitingSince(null);
			setManual(false);
		}
	}, [pendingCount]);

	// 第一次打开还没有候选时，后台可能正在生成，安静地等一会儿。
	const loaded = openings.data !== null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在首次载入时判断
	useEffect(() => {
		if (loaded && pendingCount === 0 && greetings.data?.atOpening !== false) {
			setWaitingSince(Date.now());
		}
	}, [loaded]);

	const view = greetings.data;
	if (view === null || !view.atOpening) return null;
	const total = view.greetings.length;
	const current = view.current;
	const disabled = busy || working;

	const run = async (action: () => Promise<unknown>) => {
		setWorking(true);
		try {
			await action();
			onChanged();
		} catch (error) {
			toast(errorText(error));
		} finally {
			setWorking(false);
		}
	};

	const step = (delta: number) => {
		const from = current ?? (delta > 0 ? -1 : 0);
		const next = (from + delta + total) % total;
		void run(() => api.chooseGreeting(storyId, next));
	};

	const regenerate = () =>
		void run(async () => {
			await api.generateOpenings(storyId);
			setManual(true);
			setWaitingSince(Date.now());
		});

	if (total < 2 && pending.length === 0 && !manual) {
		return (
			<div className="opening">
				<button
					type="button"
					className="btn ghost sm"
					disabled={disabled}
					onClick={regenerate}
				>
					生成开局候选
				</button>
			</div>
		);
	}

	return (
		<section className="opening" aria-label="开场">
			{total > 1 ? (
				<div className="greetnav">
					<button
						type="button"
						aria-label="上一条开场白"
						disabled={disabled}
						onClick={() => step(-1)}
					>
						‹
					</button>
					<span>
						开场白 {current === null ? "—" : current + 1} / {total}
					</span>
					<button
						type="button"
						aria-label="下一条开场白"
						disabled={disabled}
						onClick={() => step(1)}
					>
						›
					</button>
				</div>
			) : null}
			{pending.length > 0 ? (
				<ul className="opencards" aria-label="开局候选">
					{pending.map((candidate) => (
						<li key={candidate.id}>
							<button
								type="button"
								className="opencard"
								disabled={disabled}
								onClick={() =>
									void run(() => api.pickOpening(storyId, candidate.id))
								}
							>
								{candidate.raw}
							</button>
						</li>
					))}
				</ul>
			) : null}
			<button
				type="button"
				className="btn ghost sm"
				disabled={disabled || manual}
				onClick={regenerate}
			>
				{manual ? "生成中…" : "换一批开局"}
			</button>
		</section>
	);
}
