import type { WritingEntry, WritingEntryPlacement } from "@dramaticer/core";
import { useState } from "react";
import { api } from "../api";
import { Seg, Sw, sp, useAct } from "./ui";

const PLACEMENTS: readonly { v: WritingEntryPlacement; label: string }[] = [
	{ v: "before-history", label: "历史前" },
	{ v: "in-history", label: "历史中" },
	{ v: "after-history", label: "历史后" },
];

const ROLES: readonly { v: WritingEntry["role"]; label: string }[] = [
	{ v: "system", label: "系统" },
	{ v: "user", label: "玩家" },
	{ v: "assistant", label: "角色" },
];

function where(entry: WritingEntry): string {
	const place = PLACEMENTS.find((item) => item.v === entry.placement)?.label;
	const role = ROLES.find((item) => item.v === entry.role)?.label;
	return entry.placement === "in-history"
		? `${place} · 倒数第 ${entry.depth} 楼前 · ${role}`
		: `${place} · ${role}`;
}

/** 写作条目：导入预设里没对应上选项的条目，按原来的位置与角色放进上下文。 */
export function WritingEntries({
	storyId,
	entries,
	onSaved,
}: {
	readonly storyId: string;
	readonly entries: readonly WritingEntry[];
	readonly onSaved: () => void;
}) {
	const act = useAct();
	const [open, setOpen] = useState<string | null>(null);
	const [draft, setDraft] = useState<WritingEntry | null>(null);
	const visible = entries.filter((entry) => entry.scope !== "image_organizer");

	const save = (next: readonly WritingEntry[]) =>
		act(
			() =>
				api.call("PUT", sp(storyId, "/writing/entries"), {
					entries: [
						...entries.filter((entry) => entry.scope === "image_organizer"),
						...next,
					],
				}),
			() => {
				setOpen(null);
				setDraft(null);
				onSaved();
			},
		);

	const startEdit = (entry: WritingEntry) => {
		setOpen(entry.id);
		setDraft(entry);
	};

	const add = () => {
		const entry: WritingEntry = {
			id: `custom-${Date.now().toString(36)}`,
			name: "新条目",
			content: "",
			role: "system",
			placement: "after-history",
			depth: 0,
			order: visible.length,
			enabled: true,
			scope: "turn",
		};
		setOpen(entry.id);
		setDraft(entry);
	};

	const editing = draft !== null && open === draft.id;
	const isNew = editing && !visible.some((entry) => entry.id === draft.id);

	return (
		<div className="dial entries">
			<div className="entries-head">
				<div>
					<h3>写作条目</h3>
					<p>
						{visible.length === 0
							? "导入预设后，未匹配的条目在这里；也可以自己加。"
							: `共 ${visible.length} 条，启用 ${visible.filter((entry) => entry.enabled).length} 条。受上面「文风包」开关控制。`}
					</p>
				</div>
				<button type="button" className="btn sm" onClick={add}>
					新建
				</button>
			</div>
			<ul className="entry-list">
				{[...visible, ...(isNew && draft !== null ? [draft] : [])].map(
					(entry) => (
						<li key={entry.id} data-off={entry.enabled ? undefined : ""}>
							{editing && draft?.id === entry.id ? (
								<form
									className="entry-edit"
									onSubmit={(event) => {
										event.preventDefault();
										const next = isNew
											? [...visible, draft]
											: visible.map((item) =>
													item.id === draft.id ? draft : item,
												);
										void save(next);
									}}
								>
									<label>
										名字
										<input
											value={draft.name}
											onChange={(event) =>
												setDraft({ ...draft, name: event.target.value })
											}
										/>
									</label>
									<label>
										内容
										<textarea
											rows={5}
											value={draft.content}
											required
											onChange={(event) =>
												setDraft({ ...draft, content: event.target.value })
											}
										/>
									</label>
									<div className="entry-row">
										<Seg<WritingEntryPlacement>
											label="位置"
											value={draft.placement}
											options={PLACEMENTS}
											onChange={(placement) =>
												setDraft({
													...draft,
													placement,
													depth:
														placement === "in-history"
															? Math.max(draft.depth, 1)
															: 0,
												})
											}
										/>
										{draft.placement === "in-history" ? (
											<label className="inline">
												倒数第
												<input
													type="number"
													min={0}
													max={1000}
													value={draft.depth}
													onChange={(event) =>
														setDraft({
															...draft,
															depth: Math.max(
																0,
																Math.trunc(Number(event.target.value) || 0),
															),
														})
													}
												/>
												楼前
											</label>
										) : null}
									</div>
									<Seg<WritingEntry["role"]>
										label="以谁的口吻"
										value={draft.role}
										options={ROLES}
										onChange={(role) => setDraft({ ...draft, role })}
									/>
									<div className="entry-actions">
										<button type="submit" className="btn sm">
											保存
										</button>
										<button
											type="button"
											className="btn ghost sm"
											onClick={() => {
												setOpen(null);
												setDraft(null);
											}}
										>
											取消
										</button>
										{isNew ? null : (
											<button
												type="button"
												className="btn ghost sm danger"
												onClick={() =>
													void save(
														visible.filter((item) => item.id !== entry.id),
													)
												}
											>
												删除
											</button>
										)}
									</div>
								</form>
							) : (
								<div className="entry-line">
									<button
										type="button"
										className="entry-name"
										onClick={() => startEdit(entry)}
									>
										<strong>{entry.name}</strong>
										<span>{where(entry)}</span>
									</button>
									<Sw
										label={`启用 ${entry.name}`}
										checked={entry.enabled}
										onChange={(enabled) =>
											void save(
												visible.map((item) =>
													item.id === entry.id ? { ...item, enabled } : item,
												),
											)
										}
									/>
								</div>
							)}
						</li>
					),
				)}
			</ul>
		</div>
	);
}
