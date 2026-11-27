# 01：剧情走向一页

**What to build:** 合并五类规划对象的存储视图与界面为两栏；旧数据迁移进来；大纲页、导演停靠栏改为这一页。

**Blocked by:** memory-v5/01

**Status:** done

- [x] 旧故事迁移后两栏内容完整
- [x] 编辑与锁定各一条 e2e
- [x] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/direction-v5/spec.md`；方案：`docs/proposals/v5.md`

## Comments

完成：2026-11-27 两栏由旧记录只读派生（不复制存储），写入统一走 `direction/edit`；大纲页与停靠栏导演页复用同一套视图。
