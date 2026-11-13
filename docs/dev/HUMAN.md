# 需要人类处理的事项

agent 遇到只有人类才能做的事，就记在这里，并在 TASKS 里把相关任务标成 `[!]`。人类处理完之后，把对应条目的状态改成 `已完成`（可以附一句说明）；下一个会话会自动解除阻塞。

| 编号 | 状态 | 是否阻塞 | 事项 | 阻塞的任务 |
|---|---|---|---|---|
| HUMAN-01 | 已完成（2026-11-06：`.env` 已写好，后台和正文渠道暂时都用 magpie 本地网关 `antigravity/gemini-3.8-flash`；M0-T01 生成 `.env.example` 时**不要覆盖 `.env`**） | 阻塞 | 复制 `.env.example` 为 `.env`（M0-T01 之后才会有这个文件），填写**后台模型渠道**：`DRAMATICER_BG_BASE_URL`、`DRAMATICER_BG_API_KEY`、`DRAMATICER_BG_MODEL`（推荐用一个 Gemini Flash 级别的公益站或中转渠道，**不要和你平时玩用的渠道是同一个**，避免互相抢限流额度）。另外再填一个正文渠道 `DRAMATICER_MAIN_*`，M1 会用到 | M0-T11、M1-T01 |
| HUMAN-02 | 已完成（2026-11-06：充值后 `BAAI/bge-m3` 返回 200、1024 维、10 个输入 token、0.31 秒；key 已写入 `.env` 的 `SILICONFLOW_API_KEY`） | 不阻塞 | 硅基流动账户已可用，M2 的 embedding 直接接 `BAAI/bge-m3` | 无 |
| HUMAN-03 | 待处理 | 不阻塞 | 抽查 `eval-private/evalset/spotcheck.md` 里的事件题（事件题的 20%），对照 `eval-private/raw/` 的对话原文核对问题、答案和证据楼层。发现错题直接在该文件里标注即可；这条不阻塞任何任务 | 无 |
| HUMAN-04 | 已关闭（2026-11-07：人类决定不再验证 Gemini 原生协议与 gcli2api，见 ADR-0020；渠道验证以 openai-completions 为准） | 不阻塞 | 原事项：验证 Gemini 原生自定义 baseUrl 指向本机 gcli2api；已取消 | 无 |
| HUMAN-05 | 已完成（2026-11-06：`.env` 的后台与正文模型都改成 `opendesign/deepseek-v4.1-flash`，经 magpie 网关实测 `/v1/chat/completions` 返回 200、2.5 秒） | 不阻塞 | 后台渠道 `antigravity/gemini-3.8-flash` 的账号已被上游停用（HTTP 403，违反服务条款）。M0-T11 的第三个对话已用环境变量临时改用 `auto/deepseek-v4.1-flash` 完成；请在 `.env` 里换一个可用的后台渠道和模型（也可以继续用 magpie 里的其他模型），不要提交 `.env` | 无 |
| HUMAN-06 | 已完成（2026-11-06：I1 关键词补 `marker`、`worldInfo\w*`；I10 改为扫描 `packages/*/test/` 下全部文件，`*.live.test.*` 除外，共匹配 45 个测试文件；`node scripts/check-invariants.mjs` 通过，`.devloop/protected.sha` 已同步） | 不阻塞 | `scripts/check-invariants.mjs` 的两处检查缺口已补齐 | 无 |
| HUMAN-07 | 已完成（2026-11-07：目录里只有《龙族》系列，放了 5 部——Ⅰ、Ⅱ、Ⅳ、Ⅴ、前传；Ⅴ 原文件是 GB18030，已转成 UTF-8；5 部合计约 162 万内容字符、3 万个段落；全部在 `eval-private/reference/`，已被 git 忽略） | 不阻塞 | 参照小说已就位，D-T04 可以执行 | 无 |
| HUMAN-08 | 已完成（2026-11-07：接受 ADR-0023 的状态层口径——状态题用提问楼层的快照值与标准答案的一致率衡量，文本召回 13.6% @20 原样保留在报告里，45% 只作为文本召回目标） | 不阻塞 | 已确认 | 无 |
| HUMAN-09 | 已完成（2026-11-09：`bg-fallback`、`main-fallback`、`codex` 三个别名已补进 `channels.example.yaml`） | 不阻塞 | ADR-0042 声明的 `bg-fallback`、`main-fallback`、`codex` 三个模型别名已写进 `data/channels.yaml`，但 `channels.example.yaml` 里还没有；示例配置缺少它们时，按示例复制的配置没有回退路由。是否把三个别名补进示例请人类确认 | 无 |
| HUMAN-10 | 已完成（2026-11-09：I16–I18 已加入 `AGENTS.md`，`DESIGN.md` §19.7 同步说明） | 不阻塞 | `docs/proposals/plugins.md` 第七节的三条插件不变量已写进 `docs/DESIGN.md` §19.7（插件不能修改楼层原文、状态写入必须经过结算器；回合内钩子有时间预算、超时跳过并写入 Trace；代码插件的权限必须声明并在安装时展示）。这三条是否作为 I16–I18 加入 AGENTS.md 的不变量表请人类确认；确认之前 AGENTS.md 保持原样，以 DESIGN §19.7 为准 | 无 |
| HUMAN-11 | 已完成（2026-11-09：`.env` 的 `DRAMATICER_MAIN_MODEL` 已改为 `auto/deepseek-v4.1-flash`） | 不阻塞 | `.env` 的 `DRAMATICER_MAIN_MODEL`（`opendesign/deepseek-v4.1-flash`）持续返回 `failed to evaluate membership entitlement`，live 测试里渠道体检与三轮对话两项因此失败；同一网关的 `auto/deepseek-v4.1-flash`（`main-fallback` 别名）实测可用。是否把 `.env` 的正文模型换成该回退路由请人类确认；`.env` 由人类维护，agent 不改 | 无 |
| HUMAN-12 | 已完成（2026-11-09：人类确认保持 `judge`（`auto/glm-5.3`）作为裁判路由） | 不阻塞 | `data/channels.yaml` 的 `roles.judge` 当前指向 `judge`（`auto/glm-5.3`），`codex`（`codex/gpt-6.1-terra`）别名保留但未使用；本机连接 Codex 端点仍会超时。是否保持 `judge` 作为裁判路由，或改到其他可达渠道？ | 无 |
| HUMAN-13 | 已关闭（2026-11-09：人类决定不改回 `rp`，继续用 `main-fallback`） | 不阻塞 | `catie` 渠道的 `rp`（`agy-gemini-3.8-flash-medium`）在 2026-11-08 00:17 起持续返回 503「您没有可用的 Antigravity 凭证。请上传您自己的 Antigravity 凭证。」，渠道体检的流式、函数调用与预填充都失败。R2-T09.c 的最后两次运行因此有 45 道跑后提问记失败，无法重试；恢复凭证后可用 `node scripts/r2-legacy-forgetting.mjs run-all --concurrency 3` 补齐（已完成的运行会被跳过）。`rp` 同时是 `roles.writer`，所有真实写作评测都会受影响。2026-11-08 再次体检，`rp` 仍返回同样的 503；真实 60 轮试玩改用 `.devloop/scratch/R5-T14/channels.yaml`（只把 `roles.writer` 指向 `main-fallback`，其余与 `data/channels.yaml` 一致）并在 server 上用 `--channels` 启动；`data/channels.yaml` 的 `roles.writer` 也已临时改为 `main-fallback`。凭证恢复后请确认是否改回 `rp` | 无 |
| HUMAN-14 | 已关闭（2026-11-12：人类取消） | 不阻塞 | 取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。 | 无 |
| HUMAN-15 | 待处理 | 不阻塞（M6-T99 执行时需要） | M6 第一批验收要用真实 ComfyUI：请把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`（2026-11-09 检查时端口未监听），并导出一份 API 格式 workflow JSON 放到 `eval-private/comfyui/` 或告知路径。M6-T01 至 M6-T05 不需要它，使用假 provider。 | M6-T99 |
| HUMAN-16 | 待处理 | 不阻塞 | `C:\Users\theater\AppData\Local\Temp` 已经大到 `du -sh` 跑满 300 秒仍未结束，里面有多批测试超时留下的 `gap-pass-compare-*` 目录（每个几 MB 的 SQLite 库）。这个目录在仓库外，agent 不能删除；请清理其中的测试临时目录，或对 `Temp` 与仓库目录关闭 Defender 的实时扫描，门禁的 `collect` 阶段会明显加快 | 无 |
| HUMAN-17 | 待处理 | 不阻塞 | 提案 `docs/proposals/st-compat-plugins.md` 把 ST-Prompt-Template 记为 MIT，上游仓库实际声明 AGPL-3.0。C-T04 按公开文档描述的行为独立实现，没有复制或移植源码，也没有把上游包加进依赖；运行时用 `ejs`（Apache-2.0）与 `lodash`（MIT）。这个做法是否可接受请人类确认（ADR-0111） | 无 |
| HUMAN-18 | 待处理 | 不阻塞 | 提案 `docs/proposals/st-compat-plugins.md` 把酒馆助手（JS-Slash-Runner）记为 MIT，上游仓库的 LICENSE 实际是 Aladdin Free Public License。C-T05 只从公开类型定义里记录函数名、按文档描述的行为独立实现，没有复制或移植源码，也没有把上游包加进依赖；覆盖率快照里没有上游代码。这个做法是否可接受请人类确认（ADR-0124） | 无 |
