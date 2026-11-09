export interface ImageDimensions {
	readonly width: number;
	readonly height: number;
}

/** 按媒体类型给出保存文件的扩展名；第一批只接受四种常见格式。 */
export function imageExtensionOf(mediaType: string): string {
	switch (mediaType.split(";")[0]?.trim().toLowerCase()) {
		case "image/png":
			return "png";
		case "image/jpeg":
			return "jpg";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		default:
			throw new Error(`不支持的图片媒体类型：${mediaType}`);
	}
}

/**
 * 从文件头读取宽高。PNG、GIF、WebP 与 JPEG 之外的类型直接抛错；
 * 头部不完整或格式不合法同样抛错，由出图任务按行记录失败。
 */
export function readImageDimensions(
	bytes: Uint8Array,
	mediaType: string,
): ImageDimensions {
	const base = mediaType.split(";")[0]?.trim().toLowerCase();
	if (base === "image/png") return pngDimensions(bytes);
	if (base === "image/gif") return gifDimensions(bytes);
	if (base === "image/webp") return webpDimensions(bytes);
	if (base === "image/jpeg") return jpegDimensions(bytes);
	throw new Error(`不支持的图片媒体类型：${mediaType}`);
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
	return ((bytes[offset] as number) << 8) | (bytes[offset + 1] as number);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] as number) | ((bytes[offset + 1] as number) << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
	return (
		(bytes[offset] as number) |
		((bytes[offset + 1] as number) << 8) |
		((bytes[offset + 2] as number) << 16)
	);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
	return (
		((bytes[offset] as number) << 24) |
		((bytes[offset + 1] as number) << 16) |
		((bytes[offset + 2] as number) << 8) |
		(bytes[offset + 3] as number)
	);
}

function pngDimensions(bytes: Uint8Array): ImageDimensions {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (bytes.byteLength < 24) throw new Error("PNG 文件头不完整");
	for (let index = 0; index < signature.length; index += 1) {
		if (bytes[index] !== signature[index]) throw new Error("不是 PNG 文件");
	}
	const width = readUint32BE(bytes, 16);
	const height = readUint32BE(bytes, 20);
	assertDimensions(width, height, "PNG");
	return { width, height };
}

function gifDimensions(bytes: Uint8Array): ImageDimensions {
	if (bytes.byteLength < 10) throw new Error("GIF 文件头不完整");
	const header = String.fromCharCode(...bytes.subarray(0, 6));
	if (header !== "GIF87a" && header !== "GIF89a") {
		throw new Error("不是 GIF 文件");
	}
	const width = readUint16LE(bytes, 6);
	const height = readUint16LE(bytes, 8);
	assertDimensions(width, height, "GIF");
	return { width, height };
}

function webpDimensions(bytes: Uint8Array): ImageDimensions {
	if (bytes.byteLength < 30) throw new Error("WebP 文件头不完整");
	const riff = String.fromCharCode(...bytes.subarray(0, 4));
	const webp = String.fromCharCode(...bytes.subarray(8, 12));
	if (riff !== "RIFF" || webp !== "WEBP") throw new Error("不是 WebP 文件");
	const chunk = String.fromCharCode(...bytes.subarray(12, 16));
	if (chunk === "VP8X") {
		const width = readUint24LE(bytes, 24) + 1;
		const height = readUint24LE(bytes, 27) + 1;
		assertDimensions(width, height, "WebP");
		return { width, height };
	}
	if (chunk === "VP8 ") {
		const offset = 26;
		const width = readUint16LE(bytes, offset) & 0x3fff;
		const height = readUint16LE(bytes, offset + 2) & 0x3fff;
		assertDimensions(width, height, "WebP");
		return { width, height };
	}
	if (chunk === "VP8L") {
		if (bytes[20] !== 0x2f) throw new Error("WebP 无损头不合法");
		const bits =
			(bytes[21] as number) |
			((bytes[22] as number) << 8) |
			((bytes[23] as number) << 16) |
			((bytes[24] as number) << 24);
		const width = (bits & 0x3fff) + 1;
		const height = ((bits >>> 14) & 0x3fff) + 1;
		assertDimensions(width, height, "WebP");
		return { width, height };
	}
	throw new Error(`不认识的 WebP 块：${chunk}`);
}

const JPEG_START_OF_FRAME = new Set([
	0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegDimensions(bytes: Uint8Array): ImageDimensions {
	if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
		throw new Error("不是 JPEG 文件");
	}
	let offset = 2;
	while (offset + 3 < bytes.byteLength) {
		if (bytes[offset] !== 0xff) {
			throw new Error("JPEG 段类型不合法");
		}
		const segmentType = bytes[offset + 1] as number;
		offset += 2;
		if (segmentType === 0xd8 || segmentType === 0xd9) continue;
		if (segmentType === 0xda) break;
		const length = readUint16BE(bytes, offset);
		if (length < 2 || offset + length > bytes.byteLength) {
			throw new Error("JPEG 段长度不合法");
		}
		if (JPEG_START_OF_FRAME.has(segmentType)) {
			const height = readUint16BE(bytes, offset + 3);
			const width = readUint16BE(bytes, offset + 5);
			assertDimensions(width, height, "JPEG");
			return { width, height };
		}
		offset += length;
	}
	throw new Error("JPEG 里没有找到尺寸");
}

function assertDimensions(width: number, height: number, format: string): void {
	if (width < 1 || height < 1) {
		throw new Error(`${format} 图片尺寸不合法：${width}×${height}`);
	}
}
