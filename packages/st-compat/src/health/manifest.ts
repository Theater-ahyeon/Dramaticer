import { readFile } from "node:fs/promises";
import { isJsonObject } from "../json.js";

export interface SnapshotManifestFile {
	readonly role: string;
	readonly character?: string;
	readonly target: string;
}

export interface SnapshotManifest {
	readonly generatedAt: string | null;
	readonly files: readonly SnapshotManifestFile[];
}

export async function readSnapshotManifest(
	manifestPath: string,
): Promise<SnapshotManifest> {
	const text = await readFile(manifestPath, "utf8");
	return parseSnapshotManifest(JSON.parse(text));
}

export function parseSnapshotManifest(value: unknown): SnapshotManifest {
	if (!isJsonObject(value)) {
		throw new Error("manifest 根必须是对象");
	}
	if (!Array.isArray(value.files)) {
		throw new Error("manifest.files 必须是数组");
	}
	const files = value.files.map((file, index) => {
		if (!isJsonObject(file)) {
			throw new Error(`manifest.files[${index}] 必须是对象`);
		}
		if (typeof file.role !== "string" || file.role.length === 0) {
			throw new Error(`manifest.files[${index}].role 必须是非空字符串`);
		}
		if (typeof file.target !== "string" || file.target.length === 0) {
			throw new Error(`manifest.files[${index}].target 必须是非空字符串`);
		}
		if (file.character !== undefined && typeof file.character !== "string") {
			throw new Error(`manifest.files[${index}].character 必须是字符串`);
		}
		return {
			role: file.role,
			character: file.character,
			target: file.target,
		};
	});
	return {
		generatedAt:
			typeof value.generatedAt === "string" ? value.generatedAt : null,
		files,
	};
}
