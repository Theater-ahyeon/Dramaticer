# 01：按内容判断玩家意图，不干预时什么都不加

**What to build:** 玩家的自由输入（不论长短）和点选项都得到「不干预」，注入为空；只有推进按钮和固定说法触发导演。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 三个字的明确行动得到不干预，导演槽位为空
- [ ] 「继续」「推进剧情」这类说法与推进按钮等价
- [ ] 点了行动选项得到不干预
- [ ] 决策记录写明判断依据
- [ ] `pnpm check` 通过

规格：`.scratch/director-yield/spec.md`

## Comments
