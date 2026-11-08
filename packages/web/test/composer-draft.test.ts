import { afterEach, describe, expect, it } from "vitest";
import {
	clearComposerDraft,
	readComposerDraft,
	setComposerDraft,
} from "../src/chat/composer-draft";

afterEach(() => {
	clearComposerDraft("story-1");
	clearComposerDraft("story-2");
});

describe("输入框草稿", () => {
	it("按故事保存原文，读取后仍然保留直到显式清空", () => {
		setComposerDraft("story-1", "推门进去");
		expect(readComposerDraft("story-1")).toBe("推门进去");
		expect(readComposerDraft("story-1")).toBe("推门进去");
		clearComposerDraft("story-1");
		expect(readComposerDraft("story-1")).toBeNull();
	});

	it("故事之间互不影响", () => {
		setComposerDraft("story-1", "甲");
		setComposerDraft("story-2", "乙");
		expect(readComposerDraft("story-1")).toBe("甲");
		expect(readComposerDraft("story-2")).toBe("乙");
	});

	it("空白文本不写入，并清掉同一故事的旧草稿", () => {
		setComposerDraft("story-1", "先前的草稿");
		setComposerDraft("story-1", "   ");
		expect(readComposerDraft("story-1")).toBeNull();
	});
});
