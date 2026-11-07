# 开发流程使用说明（写给人类）

## 一条提示词启动

把下面这段话发给任意一个编程 agent（omp、DSH、Codex、Claude Code 都可以），在 `E:\agentcoding\Dramaticer` 目录下运行：

```text
在 E:\agentcoding\Dramaticer 启动 Dramaticer 的自主开发。步骤：
1. 检查 node（≥22.19）、pnpm、git、omp 是否可用，把版本号报告给我；缺了哪个就告诉我，然后停下。
2. 用 PowerShell 7 运行：Start-Process 'C:\Program Files\PowerShell\7\pwsh.exe' -ArgumentList '-NoLogo','-NoExit','-File','tools\devloop\devloop.ps1' -WorkingDirectory 'E:\agentcoding\Dramaticer'
   这会在一个新窗口里启动自动开发循环。你不要等它结束，也不要自己去实现任何任务。
3. 等 1 分钟，确认 .devloop\logs\ 下出现了 session-0001 的日志文件，并且 .git 已经存在。
4. 告诉我：循环已经启动；去哪里看进度；怎么停止；docs\dev\HUMAN.md 里有哪些事需要我处理。然后结束。
```

也可以不用 agent：直接双击 `tools\devloop\start.cmd`，效果一样。

## 启动后会发生什么

```
devloop.ps1（新窗口里）
  └─ 循环：每个会话都是一个全新上下文的 omp
       读 AGENTS.md → 读 HANDOFF / TASKS → 做一个任务 → pnpm check → 提交 → 写交接 → 退出
     脚本独立检查：门禁（pnpm check）、有没有进展、受保护文件有没有被改
     → 进入下一个会话
```

上下文用满的问题不会出现：每个会话只做一个任务就退出，下一个会话从仓库文件接着做。

## 你唯一需要做的事

1. **填 `.env`**（HUMAN-01、HUMAN-02，详见 `docs/dev/HUMAN.md`）。在 M0-T01 生成 `.env.example` 之后做。不填的话，循环会跳过需要密钥的任务，先做其他任务。
2. **偶尔看一眼**：
   - 进度：`docs/dev/TASKS.md`、`docs/dev/LOG.md`、`git log --oneline`
   - 里程碑报告：`docs/dev/reports/`
   - 循环为什么停了：`.devloop/STOPPED.txt`
3. **想加需求**：写进 `docs/dev/INBOX.md`，下一个会话会自动分拣。

## 循环什么时候会自己停下

| 情况 | 你该做什么 |
|---|---|
| 所有剩下的任务都被阻塞 | 处理 HUMAN.md 里的事项，然后重新启动 |
| 连续 3 个会话失败或没有进展 | 看 `.devloop/logs/` 和 `.devloop/gate.txt`；可以写进 INBOX 给出提示，然后重新启动 |
| 受保护文件被改动（AGENTS.md、门禁脚本、devloop） | 用 `git log -p` 审查；确认没问题后删除 `.devloop/protected.sha`，重新启动 |
| 达到 40 个会话（默认上限） | 直接重新启动 |
| 用了 `-PauseAtMilestone`，并且完成了一个里程碑 | 看报告，然后重新启动 |

**手动停止**：新建一个空文件 `.devloop/STOP`，当前会话结束后循环就会停下。想立刻停止，就直接关掉那个窗口。

## 防止偏离设计的机制

| 层 | 机制 |
|---|---|
| 规则 | `AGENTS.md`：会话协议、设计不变量 I1–I10、安全红线。omp、DSH、Codex 都会读 AGENTS.md；Claude Code 通过 `CLAUDE.md` 导入它 |
| 机器检查 | `scripts/check-invariants.mjs` 在每次 `pnpm check` 时运行：core 里不能出现 ST 概念、私有数据不能被提交、依赖必须登记、测试不能访问网络 |
| 外部监督 | devloop 脚本自己跑门禁、检查有没有进展，并且对受保护文件做哈希校验。agent 改了规则文件或门禁脚本，循环会立刻停下等你审查 |
| 设计变更 | 偏离设计必须写 ADR；会改变目标或里程碑的，必须写进 HUMAN.md 等你确认 |
| 定期审查 | 每个里程碑的 T99 任务都要逐条审查不变量 |

换模型的方法：给 devloop 传 `-Model <模型名>`（omp 的模型写法），或者用 `-Agent dsh`。规则文件对所有模型都一样。

## 可选参数

```powershell
pwsh -File tools/devloop/devloop.ps1 -Once               # 只跑一个会话，先观察效果
pwsh -File tools/devloop/devloop.ps1 -PauseAtMilestone   # 每完成一个里程碑就停下
pwsh -File tools/devloop/devloop.ps1 -Model magpie/auto/deepseek-v4-pro
pwsh -File tools/devloop/devloop.ps1 -Agent dsh
pwsh -File tools/devloop/devloop.ps1 -SessionMinutes 60 -MaxSessions 100
```
