import { describe, expect, it } from "vitest";
import { ChunkIndex, buildTrigramQuery } from "../src/retrieval/chunk-index.js";

describe("buildTrigramQuery", () => {
	it("去掉标点和空白后生成三字窗口", () => {
		expect(buildTrigramQuery("苏禾，在河边！")).toBe(
			'"苏禾在" OR "禾在河" OR "在河边"',
		);
	});

	it("少于三个字符返回 null", () => {
		expect(buildTrigramQuery("苏禾")).toBeNull();
		expect(buildTrigramQuery("，。 ")).toBeNull();
	});
});

describe("ChunkIndex", () => {
	it("按三元子串检索中文块", () => {
		const index = ChunkIndex.open();
		try {
			index.add([
				{
					storyId: "故事",
					nodeId: "故事:m0:s0",
					text: "清晨的集市上，苏禾买了一把青铜匕首。",
				},
				{
					storyId: "故事",
					nodeId: "故事:m1:s0",
					text: "中午大家在茶馆讨论比武大会的规则。",
				},
			]);
			expect(index.count()).toBe(2);
			const matches = index.search("苏禾买了什么匕首");
			expect(matches[0]?.nodeId).toBe("故事:m0:s0");
			expect(matches).toHaveLength(1);
		} finally {
			index.close();
		}
	});

	it("按故事和楼层过滤", () => {
		const index = ChunkIndex.open();
		try {
			index.add([
				{ storyId: "甲", nodeId: "甲:m0:s0", text: "青铜匕首放在桌上。" },
				{ storyId: "甲", nodeId: "甲:m1:s0", text: "青铜匕首被收进箱子。" },
				{ storyId: "乙", nodeId: "乙:m0:s0", text: "青铜匕首是她的武器。" },
			]);
			expect(index.search("青铜匕首", { storyId: "乙" })).toHaveLength(1);
			expect(index.search("青铜匕首", { storyId: "乙" })[0]?.nodeId).toBe(
				"乙:m0:s0",
			);
			expect(
				index
					.search("青铜匕首", { nodeIds: ["甲:m1:s0"] })
					.map((match) => match.nodeId),
			).toEqual(["甲:m1:s0"]);
			expect(index.search("青铜匕首", { nodeIds: [] })).toEqual([]);
		} finally {
			index.close();
		}
	});

	it("写入与查询共用规范化，全角文本和带标点的查询都能命中", () => {
		const index = ChunkIndex.open();
		try {
			index.add([
				{
					storyId: "故事",
					nodeId: "故事:m0:s0",
					text: "编号１２３的青铜匕首，放在集市上。",
				},
			]);
			expect(index.search("１２３的青铜匕首")[0]?.nodeId).toBe("故事:m0:s0");
			expect(index.search("编号，１２３，青铜匕首")[0]?.nodeId).toBe(
				"故事:m0:s0",
			);
			expect(index.search("青铜匕首。")).toHaveLength(1);
		} finally {
			index.close();
		}
	});

	it("规范化后没有可检索字符的块不写入", () => {
		const index = ChunkIndex.open();
		try {
			index.add([{ storyId: "故事", nodeId: "故事:m0:s0", text: "……，。" }]);
			expect(index.count()).toBe(0);
			expect(index.search("……")).toEqual([]);
		} finally {
			index.close();
		}
	});

	it("重复写入同一个块会保留两条记录", () => {
		const index = ChunkIndex.open();
		try {
			const chunk = {
				storyId: "故事",
				nodeId: "故事:m0:s0",
				text: "青铜匕首",
			};
			index.add([chunk]);
			index.add([chunk]);
			expect(index.count()).toBe(2);
			expect(index.search("青铜匕首")).toHaveLength(2);
		} finally {
			index.close();
		}
	});

	it("拒绝非法查询参数和空块", () => {
		const index = ChunkIndex.open();
		try {
			expect(() => index.search("青铜匕首", { limit: 0 })).toThrow(
				"检索条数必须是 1 到 1000 之间的整数",
			);
			expect(() => index.search("青铜匕首", { limit: 1001 })).toThrow(
				"检索条数必须是 1 到 1000 之间的整数",
			);
			expect(() => index.search("青铜匕首", { limit: 1.5 })).toThrow(
				"检索条数必须是 1 到 1000 之间的整数",
			);
			expect(() => index.search("青铜匕首", { storyId: "" })).toThrow(
				"故事 id 必须是非空字符串",
			);
			expect(() =>
				index.add([{ storyId: "", nodeId: "x", text: "文本" }]),
			).toThrow("文本块[0] 的 storyId 必须是非空字符串");
			expect(() =>
				index.add([{ storyId: "x", nodeId: "", text: "文本" }]),
			).toThrow("文本块[0] 的 nodeId 必须是非空字符串");
			expect(() =>
				index.add([{ storyId: "x", nodeId: "x:m0:s0", text: "" }]),
			).toThrow("文本块[0] 的 text 必须是非空字符串");
		} finally {
			index.close();
		}
	});
});
