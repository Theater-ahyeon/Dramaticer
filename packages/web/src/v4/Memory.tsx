import { Fragment, type ReactNode, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import {
	Editable,
	errorText,
	parseValue,
	showValue,
	sp,
	useLoad,
	useToast,
} from "./ui";

interface Statement {
	readonly id: string;
	readonly text: string;
	readonly floorNo: number | null;
	readonly source: "auto" | "player";
	readonly locked: boolean;
	readonly old: boolean;
	readonly validUntilFloor: number | null;
	readonly quote: string | null;
}

interface Page {
	readonly id: string;
	readonly kind: string;
	readonly name: string;
	readonly aliases: readonly string[];
	readonly uptoFloor: number;
	readonly lead: string;
	readonly leadLocked: boolean;
	readonly sections: readonly {
		readonly title: string;
		readonly statements: readonly Statement[];
	}[];
}

interface StateItem {
	readonly target: string;
	readonly path: readonly string[];
	readonly owner: string;
	readonly item: string;
	readonly value: unknown;
	readonly floorNo: number;
	readonly source: string;
	readonly locked: boolean;
	readonly history: readonly {
		readonly value: unknown;
		readonly floorNo: number;
		readonly source: string;
	}[];
}

interface Secret {
	readonly id: string;
	readonly text: string;
	readonly knowers: readonly string[];
	readonly unaware: readonly string[];
	readonly floorNo: number | null;
	readonly locked: boolean;
	readonly edited: boolean;
}

interface MemoryView {
	readonly pages: readonly Page[];
	readonly state: readonly StateItem[];
	readonly secrets: readonly Secret[];
	readonly timeline: readonly {
		readonly id: string;
		readonly title: string;
		readonly floors: number;
		readonly summary: string;
		readonly present: readonly string[];
		readonly changes: readonly string[];
		readonly locked: boolean;
	}[];
	readonly prefs: readonly {
		readonly id: string;
		readonly text: string;
		readonly origin: string;
		readonly disabled: boolean;
		readonly locked: boolean;
	}[];
	readonly rejections: readonly {
		readonly id: number;
		readonly kind: string;
		readonly text: string;
		readonly reason: string;
	}[];
}

const TABS = [
	["wiki", "百科"],
	["state", "状态"],
	["secret", "秘密"],
	["line", "时间线"],
	["rule", "偏好"],
] as const;

type Tab = (typeof TABS)[number][0];

/** 把句子里出现的其他页面名字换成可以点的链接。 */
function linkify(
	text: string,
	pages: readonly Page[],
	self: string,
	open: (id: string) => void,
): ReactNode[] {
	const names = pages
		.filter((page) => page.id !== self && page.name.length > 1)
		.map((page) => ({ id: page.id, name: page.name }))
		.sort((left, right) => right.name.length - left.name.length);
	const out: ReactNode[] = [];
	let rest = text;
	let guard = 0;
	while (rest.length > 0 && guard < 200) {
		guard += 1;
		let best: { index: number; id: string; name: string } | null = null;
		for (const item of names) {
			const index = rest.indexOf(item.name);
			if (index >= 0 && (best === null || index < best.index)) {
				best = { index, ...item };
			}
		}
		if (best === null) break;
		if (best.index > 0) out.push(rest.slice(0, best.index));
		const target = best.id;
		out.push(
			<a
				key={`${guard}-${target}`}
				href={`#${target}`}
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					open(target);
				}}
			>
				{best.name}
			</a>,
		);
		rest = rest.slice(best.index + best.name.length);
	}
	if (rest.length > 0) out.push(rest);
	return out;
}

/** 平时显示带链接的句子，点一下进入修改。 */
function LinkedText({
	text,
	className,
	pages,
	self,
	open,
	onCommit,
}: {
	readonly text: string;
	readonly className?: string;
	readonly pages: readonly Page[];
	readonly self: string;
	readonly open: (id: string) => void;
	readonly onCommit: (text: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	if (!editing) {
		return (
			<p
				className={className}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: 可以聚焦后进入修改
				tabIndex={0}
				onClick={() => setEditing(true)}
				onKeyDown={(event) => {
					if (event.key === "Enter") setEditing(true);
				}}
				style={{ cursor: "text" }}
			>
				{linkify(text, pages, self, open)}
			</p>
		);
	}
	return (
		<p
			className={className}
			contentEditable
			suppressContentEditableWarning
			ref={(element) => element?.focus()}
			onBlur={(event) => {
				const next = (event.currentTarget.textContent ?? "").trim();
				setEditing(false);
				if (next !== text.trim()) onCommit(next);
			}}
		>
			{text}
		</p>
	);
}

/** 记忆页：百科、状态、秘密、时间线、偏好，全部可以就地修改。 */
export function Memory() {
	const { storyId = "" } = useParams();
	const [search, setSearch] = useSearchParams();
	const toast = useToast();
	const memory = useLoad<MemoryView>(
		() => api.get(sp(storyId, "/memory")),
		[storyId],
	);
	const tab = (
		TABS.some(([id]) => id === search.get("tab")) ? search.get("tab") : "wiki"
	) as Tab;
	const pageParam = search.get("page");
	const focus = search.get("focus");
	const [pageId, setPageId] = useState<string | null>(pageParam);
	const [raw, setRaw] = useState<ReadonlySet<string>>(new Set());
	const [history, setHistory] = useState<string | null>(null);
	const [fieldError, setFieldError] = useState<{
		key: string;
		text: string;
	} | null>(null);
	const [rule, setRule] = useState("");

	const data = memory.data;
	useEffect(() => {
		if (data === null) return;
		if (pageId === null || !data.pages.some((page) => page.id === pageId)) {
			setPageId(data.pages[0]?.id ?? null);
		}
	}, [data, pageId]);
	useEffect(() => {
		if (pageParam === null) return;
		setPageId(pageParam);
	}, [pageParam]);
	// 从上下文跳过来时，翻到这一条对应的行或语句。
	const focusReady = data !== null;
	useEffect(() => {
		if (focus === null || !focusReady) return;
		document
			.querySelector(`[data-focus="${CSS.escape(focus)}"]`)
			?.scrollIntoView({ block: "center" });
	}, [focus, focusReady]);

	/** 写一次修改；失败的原因显示在被改的那一处。 */
	const write = async (
		key: string,
		path: string,
		body: unknown,
		undo?: { path: string; body: unknown },
	) => {
		try {
			await api.call("POST", sp(storyId, path), body);
		} catch (error) {
			setFieldError({ key, text: errorText(error) });
			memory.reload();
			return;
		}
		setFieldError(null);
		memory.reload();
		toast(
			"已保存并锁定，下一轮生效",
			undo === undefined
				? undefined
				: () => {
						api
							.call("POST", sp(storyId, undo.path), undo.body)
							.then(() => memory.reload())
							.catch((error: unknown) => toast(errorText(error)));
					},
		);
	};

	const problem = (key: string) =>
		fieldError?.key === key ? (
			<div className="v4err">{fieldError.text}</div>
		) : null;

	if (memory.error !== null) return <div className="v4err">{memory.error}</div>;
	if (data === null) return <p className="v4empty">正在读取记忆…</p>;
	const page = data.pages.find((item) => item.id === pageId) ?? null;

	let lastKind = "";
	return (
		<section data-view="memory">
			<div className="vh">
				<div>
					<h1>记忆</h1>
					<p>
						系统记下的每一样东西都在这里。点任何一句就能改；你改过的会锁定，不会再被自动覆盖。原文永远不动。
					</p>
				</div>
			</div>
			<div className="subtabs">
				{TABS.map(([id, label]) => (
					<button
						type="button"
						key={id}
						aria-selected={tab === id}
						onClick={() => setSearch({ tab: id })}
					>
						{label}
					</button>
				))}
			</div>

			{tab === "wiki" ? (
				<div className="wiki">
					<div className="plist">
						{data.pages.length === 0 ? (
							<p className="v4empty">
								还没有页面。写几楼之后，自动记录会把人物和地点整理出来。
							</p>
						) : null}
						{data.pages.map((item) => {
							const header =
								item.kind === lastKind ? null : (
									<span className="label">{item.kind}</span>
								);
							lastKind = item.kind;
							return (
								<Fragment key={item.id}>
									{header}
									<button
										type="button"
										aria-pressed={item.id === pageId}
										onClick={() => setPageId(item.id)}
									>
										<span>{item.name}</span>
										<small>
											{item.uptoFloor > 0 ? `第 ${item.uptoFloor} 楼` : ""}
										</small>
									</button>
								</Fragment>
							);
						})}
					</div>
					{page === null ? null : (
						<article
							className={page.id === pageParam ? "page is-focus" : "page"}
							data-focus={page.id}
						>
							<div
								style={{
									display: "flex",
									flexWrap: "wrap",
									alignItems: "center",
									gap: 10,
								}}
							>
								<h2>{page.name}</h2>
								<span className="pill teal">{page.kind}</span>
								{page.uptoFloor > 0 ? (
									<span className="pill mute">写到第 {page.uptoFloor} 楼</span>
								) : null}
								<button
									type="button"
									className="btn ghost sm"
									onClick={() => {
										memory.reload();
										toast("已从记录重新整理这一页；你锁定的句子保持不变");
									}}
								>
									重新整理
								</button>
							</div>
							<LinkedText
								className="lead"
								text={page.lead || "（还没有简介，点这里写一句）"}
								pages={data.pages}
								self={page.id}
								open={setPageId}
								onCommit={(text) =>
									write(
										`${page.id}|lead`,
										"/memory/edit",
										{
											kind: "wiki",
											target: `${page.id}|lead`,
											value: { text },
										},
										{
											path: "/memory/edit",
											body: {
												kind: "wiki",
												target: `${page.id}|lead`,
												reset: true,
											},
										},
									)
								}
							/>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 10,
									marginTop: 8,
								}}
							>
								<span className="num">来自设定</span>
								<button
									type="button"
									className="lock"
									aria-pressed={page.leadLocked}
									onClick={() =>
										write(
											`${page.id}|lead`,
											"/memory/edit",
											page.leadLocked
												? {
														kind: "wiki",
														target: `${page.id}|lead`,
														reset: true,
													}
												: {
														kind: "wiki",
														target: `${page.id}|lead`,
														value: { text: page.lead },
													},
										)
									}
								>
									{page.leadLocked ? "已锁定" : "锁定"}
								</button>
							</div>
							{problem(`${page.id}|lead`)}
							{page.sections.map((section) => (
								<Fragment key={section.title}>
									<h3>{section.title}</h3>
									{section.statements.map((statement) => {
										const target = `${page.id}|${statement.id}`;
										return (
											<div
												className={statement.old ? "st old" : "st"}
												key={statement.id}
											>
												<LinkedText
													text={statement.text}
													pages={data.pages}
													self={page.id}
													open={setPageId}
													onCommit={(text) =>
														write(
															target,
															"/memory/edit",
															{ kind: "wiki", target, value: { text } },
															{
																path: "/memory/edit",
																body: { kind: "wiki", target, reset: true },
															},
														)
													}
												/>
												<div className="m">
													<span className="num">
														{statement.old && statement.validUntilFloor !== null
															? `至第 ${statement.validUntilFloor} 楼`
															: statement.floorNo === null
																? ""
																: `第 ${statement.floorNo} 楼`}
													</span>
													<span
														className={`pill ${statement.source === "player" ? "gold" : "mute"} src`}
													>
														{statement.source === "player" ? "你改的" : "自动"}
													</span>
													{statement.quote === null ? null : (
														<button
															type="button"
															className="btn ghost sm"
															onClick={() => {
																const next = new Set(raw);
																if (next.has(target)) next.delete(target);
																else next.add(target);
																setRaw(next);
															}}
														>
															原文
														</button>
													)}
													<button
														type="button"
														className="lock"
														aria-pressed={statement.locked}
														onClick={() =>
															write(target, "/memory/edit", {
																kind: "wiki",
																target,
																locked: !statement.locked,
															})
														}
													>
														{statement.locked ? "已锁定" : "锁定"}
													</button>
													<button
														type="button"
														className="btn ghost sm"
														onClick={() =>
															write(
																target,
																"/memory/edit",
																{ kind: "wiki", target, disabled: true },
																{
																	path: "/memory/edit",
																	body: {
																		kind: "wiki",
																		target,
																		disabled: false,
																	},
																},
															)
														}
													>
														删掉
													</button>
												</div>
												{statement.quote !== null && raw.has(target) ? (
													<div className="raw">{statement.quote}</div>
												) : null}
												{problem(target)}
											</div>
										);
									})}
								</Fragment>
							))}
						</article>
					)}
				</div>
			) : null}

			{tab === "state" ? (
				<div className="tblwrap">
					<table className="tbl">
						<thead>
							<tr>
								<th>谁 / 什么</th>
								<th>项目</th>
								<th>现在</th>
								<th>最后变化</th>
							</tr>
						</thead>
						<tbody>
							{data.state.map((item) => (
								<Fragment key={item.target}>
									<tr
										className={focus === item.target ? "is-focus" : undefined}
										data-focus={item.target}
									>
										<td>{item.owner}</td>
										<td>{item.item}</td>
										<Editable
											as="td"
											value={showValue(item.value)}
											onCommit={(text) =>
												write(
													item.target,
													"/memory/state",
													{
														path: item.path,
														value: parseValue(text, item.value),
													},
													{
														path: "/memory/rollback",
														body: { target: item.target, value: item.value },
													},
												)
											}
										/>
										<td className="num" style={{ color: "var(--muted)" }}>
											第 {item.floorNo} 楼{" "}
											<span
												className={`pill ${item.source === "player" ? "gold" : "mute"}`}
											>
												{item.locked
													? "已锁定"
													: item.source === "player"
														? "你改的"
														: "自动"}
											</span>{" "}
											<button
												type="button"
												className="btn ghost sm"
												onClick={() =>
													setHistory(
														history === item.target ? null : item.target,
													)
												}
											>
												历史 {item.history.length}
											</button>
										</td>
									</tr>
									{fieldError?.key === item.target ? (
										<tr>
											<td colSpan={4}>{problem(item.target)}</td>
										</tr>
									) : null}
									{history === item.target ? (
										<tr>
											<td colSpan={4}>
												<div className="hist">
													{item.history.map((version, index) => (
														// biome-ignore lint/suspicious/noArrayIndexKey: 历史按顺序排列
														<span key={index}>
															第 {version.floorNo} 楼 ·{" "}
															{version.source === "player" ? "你" : "自动"} ·{" "}
															{version.value === null
																? "（移除）"
																: showValue(version.value)}{" "}
															<button
																type="button"
																onClick={() =>
																	write(item.target, "/memory/rollback", {
																		target: item.target,
																		value: version.value,
																	})
																}
															>
																回到这一版
															</button>
														</span>
													))}
												</div>
											</td>
										</tr>
									) : null}
								</Fragment>
							))}
						</tbody>
					</table>
					{data.state.length === 0 ? (
						<p className="v4empty">还没有记下状态。</p>
					) : null}
				</div>
			) : null}

			{tab === "secret" ? (
				<div className="tblwrap">
					<table className="tbl">
						<thead>
							<tr>
								<th>秘密</th>
								<th>知道的人</th>
								<th>不知道的人</th>
								<th>来源</th>
							</tr>
						</thead>
						<tbody>
							{data.secrets.map((secret) => {
								const save = (patch: Partial<Secret>) =>
									write(
										secret.id,
										"/memory/edit",
										{
											kind: "secret",
											target: secret.id,
											value: {
												text: patch.text ?? secret.text,
												knowers: patch.knowers ?? secret.knowers,
												unaware: patch.unaware ?? secret.unaware,
											},
										},
										{
											path: "/memory/edit",
											body: { kind: "secret", target: secret.id, reset: true },
										},
									);
								const names = (text: string) =>
									text
										.split(/[、,，\s]+/)
										.map((name) => name.trim())
										.filter((name) => name !== "");
								return (
									<Fragment key={secret.id}>
										<tr>
											<Editable
												as="td"
												value={secret.text}
												onCommit={(text) => save({ text })}
											/>
											<Editable
												as="td"
												value={secret.knowers.join("、")}
												onCommit={(text) => save({ knowers: names(text) })}
											/>
											<Editable
												as="td"
												value={secret.unaware.join("、")}
												onCommit={(text) => save({ unaware: names(text) })}
											/>
											<td className="num" style={{ color: "var(--muted)" }}>
												{secret.floorNo === null
													? "你加的"
													: `第 ${secret.floorNo} 楼`}{" "}
												{secret.locked ? (
													<span className="pill gold">已锁定</span>
												) : null}{" "}
												<button
													type="button"
													className="btn ghost sm"
													onClick={() =>
														write(
															secret.id,
															"/memory/edit",
															{
																kind: "secret",
																target: secret.id,
																value: {
																	text: secret.text,
																	knowers: secret.knowers,
																	unaware: secret.unaware,
																},
																disabled: true,
															},
															{
																path: "/memory/edit",
																body: {
																	kind: "secret",
																	target: secret.id,
																	disabled: false,
																},
															},
														)
													}
												>
													删掉
												</button>
											</td>
										</tr>
										{fieldError?.key === secret.id ? (
											<tr>
												<td colSpan={4}>{problem(secret.id)}</td>
											</tr>
										) : null}
									</Fragment>
								);
							})}
						</tbody>
					</table>
					{data.secrets.length === 0 ? (
						<p className="v4empty">还没有只有一部分人知道的事。</p>
					) : null}
				</div>
			) : null}

			{tab === "line" ? (
				<div className="spine">
					{data.timeline.length === 0 ? (
						<p className="v4empty">一场结束后，这里会出现它的摘要。</p>
					) : null}
					{data.timeline.map((scene, index) => (
						<details
							key={scene.id}
							open={focus === scene.id || index === data.timeline.length - 1}
							className={focus === scene.id ? "is-focus" : undefined}
							data-focus={scene.id}
						>
							<summary>
								{scene.title}
								<small>
									{scene.floors} 楼 · {scene.present.join("、")}
									{scene.locked ? " · 已锁定" : ""}
								</small>
							</summary>
							<Editable
								className="sum"
								value={scene.summary}
								onCommit={(text) =>
									write(
										scene.id,
										"/memory/edit",
										{ kind: "summary", target: scene.id, value: { text } },
										{
											path: "/memory/edit",
											body: { kind: "summary", target: scene.id, reset: true },
										},
									)
								}
							/>
							{problem(scene.id)}
							<ul>
								{scene.changes.map((change) => (
									<li key={change}>
										<b>◆</b>
										{change}
									</li>
								))}
							</ul>
						</details>
					))}
				</div>
			) : null}

			{tab === "rule" ? (
				<div>
					<div className="rows">
						{data.prefs.map((pref) => (
							<Fragment key={pref.id}>
								<div
									className={focus === pref.id ? "is-focus" : undefined}
									data-focus={pref.id}
									style={pref.disabled ? { opacity: 0.5 } : undefined}
								>
									<Editable
										as="span"
										value={pref.text}
										onCommit={(text) =>
											write(
												pref.id,
												"/memory/prefs",
												{ id: pref.id, text },
												{
													path: "/memory/prefs",
													body: {
														id: pref.id,
														text: pref.text,
														disabled: pref.disabled,
													},
												},
											)
										}
									/>
									<span>
										{pref.origin}{" "}
										{pref.locked ? (
											<span className="pill gold">已锁定</span>
										) : null}{" "}
										<button
											type="button"
											className="btn ghost sm"
											onClick={() =>
												write(
													pref.id,
													"/memory/prefs",
													{ id: pref.id, disabled: !pref.disabled },
													{
														path: "/memory/prefs",
														body: { id: pref.id, disabled: pref.disabled },
													},
												)
											}
										>
											{pref.disabled ? "恢复" : "不用了"}
										</button>
									</span>
								</div>
								{problem(pref.id)}
							</Fragment>
						))}
					</div>
					{problem("new-rule")}
					<div className="say" style={{ marginTop: 14 }}>
						<textarea
							rows={1}
							value={rule}
							placeholder="加一条：例如「不要替我说话」"
							onChange={(event) => setRule(event.target.value)}
						/>
						<button
							type="button"
							className="btn"
							onClick={() => {
								const text = rule.trim();
								if (text === "") return;
								setRule("");
								void write("new-rule", "/memory/prefs", { text });
							}}
						>
							加上
						</button>
					</div>
					{data.rejections.length > 0 ? (
						<>
							<div className="label" style={{ marginTop: 22 }}>
								被挡下的自动写入
							</div>
							<div className="rows">
								{data.rejections.map((item) => (
									<div key={item.id}>
										<span>{item.text}</span>
										<span>{item.reason}</span>
									</div>
								))}
							</div>
						</>
					) : null}
				</div>
			) : null}
		</section>
	);
}
