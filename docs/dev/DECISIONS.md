# 决策记录（ADR）

格式：编号、日期、背景、选项、决定、影响。只追加新条目；被推翻的旧决策标记为"已被 ADR-xxxx 取代"，不要删除。

`docs/DESIGN.md` 附录 A 里的 Q1–Q28 是设计阶段的决策，这里不重复记录。

---

## ADR-0001 开发工具链（2026-11-06）
- **背景**：项目由 DeepSeek 驱动的 agent 自主开发，需要能无人值守地循环运行。
- **决定**：
  - 主 agent 用 oh-my-pi（`omp -p --auto-approve --max-time`），默认使用 omp 自己配置的 DeepSeek 模型；DeepSeek Harness 的 headless 模式作为备用。由 `tools/devloop/devloop.ps1` 驱动，每个会话做一个任务，会话之间通过仓库文件交接。
  - 测试用 vitest；lint 和格式化用 biome；数据库用 better-sqlite3。
- **影响**：如果 better-sqlite3 在 Windows 加 Node 24 上装不上，允许改用 `node:sqlite`，但要新写一条 ADR 记录下来。
