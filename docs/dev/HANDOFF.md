# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：0（人工初始化）
- 任务：无
- 结果：仓库只有设计文档和开发协议，还没有任何代码。

## 当前状态
- 已完成：`docs/DESIGN.md`、`AGENTS.md`、`docs/dev/*`、`scripts/check-invariants.mjs`、`tools/devloop/`
- 门禁：`pnpm check` 目前还不存在，由 M0-T01 建立

## 下一步
- 执行 M0-T01（仓库与工程骨架）

## 注意事项
- 私有数据在 `D:\SillyTavern\TauriTavern\default-user\`，只读；单个文件可能有几十 MB，必须流式处理
- 本机环境：Node 24、pnpm 10、Windows 11；shell 可以用 PowerShell 7 或 Git Bash
- `.env` 已经存在，由人类填写，**不要覆盖**；`.env.example` 只列出变量名
- 后台渠道（magpie 本地网关，`antigravity/gemini-3.8-flash`）实测：即使 `max_tokens=20`，也会产生大约 750 个思考 token。M0-T11 的客户端要支持传入思考档位或 `reasoning_effort` 参数并默认调低（先实测网关是否认这个参数），同时把思考 token 计入用量统计
