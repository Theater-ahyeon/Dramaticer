import { crc32, deflateSync } from "node:zlib";
import { encode as encodeText } from "png-chunk-text";

const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function chunk(name: string, data: Uint8Array): Buffer {
	const type = Buffer.from(name, "ascii");
	const body = Buffer.from(data);
	const out = Buffer.alloc(12 + body.length);
	out.writeUInt32BE(body.length, 0);
	type.copy(out, 4);
	body.copy(out, 8);
	const crc = crc32(Buffer.concat([type, body])) >>> 0;
	out.writeUInt32BE(crc, 8 + body.length);
	return out;
}

export interface PngTextFixture {
	keyword: string;
	value: string;
}

/** 生成 1x1 的合法 PNG，把角色卡 JSON 的 base64 写进 tEXt 块 */
export function buildPngCard(textChunks: readonly PngTextFixture[]): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(1, 0);
	ihdr.writeUInt32BE(1, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const parts = [
		PNG_SIGNATURE,
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 255]))),
		...textChunks.map((item) => {
			const encoded = encodeText(
				item.keyword,
				Buffer.from(item.value, "utf8").toString("base64"),
			);
			return chunk(encoded.name, encoded.data);
		}),
		chunk("IEND", new Uint8Array(0)),
	];
	return Buffer.concat(parts);
}
