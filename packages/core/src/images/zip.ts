import { inflateRawSync } from "node:zlib";

/**
 * 从 zip 里取出第一个以 `extension` 结尾的文件。只支持存储与 deflate 两种
 * 压缩方式，足够读取图像接口返回的单图压缩包；按中央目录定位，不依赖本地头里的大小。
 */
export function extractFirstZipEntry(
	bytes: Uint8Array,
	extension: string,
): { readonly name: string; readonly bytes: Uint8Array } | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const EOCD = 0x06054b50;
	let eocd = -1;
	for (
		let i = bytes.length - 22;
		i >= Math.max(0, bytes.length - 65_557);
		i--
	) {
		if (view.getUint32(i, true) === EOCD) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) return null;
	const count = view.getUint16(eocd + 10, true);
	let offset = view.getUint32(eocd + 16, true);
	const decoder = new TextDecoder();
	const wanted = extension.toLowerCase();
	for (let n = 0; n < count; n++) {
		if (
			offset + 46 > bytes.length ||
			view.getUint32(offset, true) !== 0x02014b50
		) {
			throw new Error("zip 中央目录损坏");
		}
		const method = view.getUint16(offset + 10, true);
		const compressedSize = view.getUint32(offset + 20, true);
		const nameLength = view.getUint16(offset + 28, true);
		const extraLength = view.getUint16(offset + 30, true);
		const commentLength = view.getUint16(offset + 32, true);
		const localOffset = view.getUint32(offset + 42, true);
		const name = decoder.decode(
			bytes.subarray(offset + 46, offset + 46 + nameLength),
		);
		offset += 46 + nameLength + extraLength + commentLength;
		if (!name.toLowerCase().endsWith(wanted) || name.startsWith("__MACOSX")) {
			continue;
		}
		if (view.getUint32(localOffset, true) !== 0x04034b50) {
			throw new Error(`zip 本地文件头损坏：${name}`);
		}
		const localName = view.getUint16(localOffset + 26, true);
		const localExtra = view.getUint16(localOffset + 28, true);
		const start = localOffset + 30 + localName + localExtra;
		const data = bytes.subarray(start, start + compressedSize);
		if (method === 0) return { name, bytes: new Uint8Array(data) };
		if (method === 8)
			return { name, bytes: new Uint8Array(inflateRawSync(data)) };
		throw new Error(`zip 压缩方式不支持：${method}（${name}）`);
	}
	return null;
}
