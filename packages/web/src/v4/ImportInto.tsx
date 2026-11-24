import type {
	ImportStoryCounts,
	ImportStoryRequest,
	ImportStoryResult,
} from "@dramaticer/protocol";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { api } from "../api";
import { ErrorNotice } from "../components/ErrorNotice";

type CardFile =
	| { readonly format: "png"; readonly data: string }
	| {
			readonly format: "json";
			readonly data: string;
	  };

/** 往已有故事里再导入一张卡或世界书；设定页里展开使用。 */
export function ImportInto({
	storyId,
	onDone,
}: {
	readonly storyId: string;
	readonly onDone: () => void;
}) {
	const [cardFile, setCardFile] = useState<CardFile | null>(null);
	const [worlds, setWorlds] = useState<readonly string[]>([]);
	const [reading, setReading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<ImportStoryResult | null>(null);
	const [error, setError] = useState<unknown>(null);

	const onCardChange = async (
		event: ChangeEvent<HTMLInputElement>,
	): Promise<void> => {
		const file = event.target.files?.[0];
		setResult(null);
		setError(null);
		if (file === undefined) {
			setCardFile(null);
			return;
		}
		setReading(true);
		try {
			setCardFile(await readCardFile(file));
		} catch (value) {
			setCardFile(null);
			setError(value);
		} finally {
			setReading(false);
		}
	};

	const onWorldsChange = async (
		event: ChangeEvent<HTMLInputElement>,
	): Promise<void> => {
		const files = [...(event.target.files ?? [])];
		setReading(true);
		try {
			setWorlds(await Promise.all(files.map((file) => file.text())));
		} catch (value) {
			setError(value);
		} finally {
			setReading(false);
		}
	};

	const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();
		if (cardFile === null) {
			setError(new Error("先选一张角色卡（PNG 或 JSON）"));
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const request: ImportStoryRequest = {
				card: cardFile,
				...(worlds.length === 0 ? {} : { worlds }),
			};
			const imported = await api.importCard(storyId, request);
			setResult(imported);
			onDone();
		} catch (value) {
			setError(value);
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className="import-into" aria-label="导入">
			<ErrorNotice error={error} />
			<form className="import-form" onSubmit={onSubmit}>
				<label className="import-field">
					<span>角色卡文件</span>
					<input
						type="file"
						accept=".png,.json,image/png,application/json"
						onChange={onCardChange}
					/>
				</label>
				<label className="import-field">
					<span>世界书文件（可多选）</span>
					<input
						type="file"
						accept=".json,application/json"
						multiple
						onChange={onWorldsChange}
					/>
				</label>
				<button type="submit" disabled={busy || reading || cardFile === null}>
					{busy ? "导入中…" : "导入"}
				</button>
			</form>
			{result === null ? null : (
				<div className="import-result">
					<h2>{result.cardName}</h2>
					<ImportCounts counts={result.imported} />
				</div>
			)}
		</section>
	);
}

function ImportCounts({ counts }: { readonly counts: ImportStoryCounts }) {
	const rows = [
		[
			"实体",
			`新建 ${counts.entities.created}、合并 ${counts.entities.merged}、别名 ${counts.entities.aliases}`,
		],
		[
			"世界书",
			`新增 ${counts.lore.inserted}、已有 ${counts.lore.existing}、跳过 ${counts.lore.skipped}`,
		],
		["事件", `新增 ${counts.events.inserted}、更新 ${counts.events.updated}`],
		[
			"NPC 议程",
			`新增 ${counts.npcAgendas.inserted}、更新 ${counts.npcAgendas.updated}`,
		],
		["剧情小品", `替换 ${counts.bits.replaced}`],
	];
	return (
		<>
			<dl className="import-counts">
				{rows.map(([label, value]) => (
					<div key={label}>
						<dt>{label}</dt>
						<dd>{value}</dd>
					</div>
				))}
			</dl>
			{counts.dependencies.issues.length === 0 ? null : (
				<div>
					<h3>依赖问题</h3>
					<ul className="import-issues">
						{counts.dependencies.issues.map((issue) => (
							<li key={`${issue.kind}:${issue.name}:${issue.level}`}>
								{issue.level === "required" ? "必需：" : "建议："}
								{issue.message}
							</li>
						))}
					</ul>
				</div>
			)}
		</>
	);
}

async function readCardFile(file: File): Promise<CardFile> {
	const name = file.name.toLowerCase();
	if (name.endsWith(".png")) {
		return {
			format: "png",
			data: toBase64(new Uint8Array(await file.arrayBuffer())),
		};
	}
	if (name.endsWith(".json")) {
		return { format: "json", data: await file.text() };
	}
	throw new Error("角色卡必须是 PNG 或 JSON 文件");
}

function toBase64(bytes: Uint8Array): string {
	const chunkSize = 0x8000;
	let binary = "";
	for (let index = 0; index < bytes.length; index += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
	}
	return btoa(binary);
}
