declare module "png-chunks-extract" {
	export interface PngChunk {
		name: string;
		data: Uint8Array;
	}
	export default function extractChunks(data: Uint8Array): PngChunk[];
}

declare module "png-chunk-text" {
	export interface PngTextChunk {
		name: "tEXt";
		data: Uint8Array;
	}
	export interface DecodedText {
		keyword: string;
		text: string;
	}
	export function encode(keyword: string, text: string): PngTextChunk;
	export function decode(
		chunk: { name: string; data: Uint8Array } | Uint8Array,
	): DecodedText;
}
