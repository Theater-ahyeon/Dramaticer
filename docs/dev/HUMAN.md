# 需要人类处理的事项

agent 遇到只有人类才能做的事，就记在这里，并在 TASKS 里把相关任务标成 `[!]`。人类处理完之后，把对应条目的状态改成 `已完成`（可以附一句说明）；下一个会话会自动解除阻塞。

| 编号 | 状态 | 是否阻塞 | 事项 | 阻塞的任务 |
|---|---|---|---|---|
| HUMAN-01 | 已完成（2026-11-06：`.env` 已写好，后台和正文渠道暂时都用 magpie 本地网关 `antigravity/gemini-3.8-flash`；M0-T01 生成 `.env.example` 时**不要覆盖 `.env`**） | 阻塞 | 复制 `.env.example` 为 `.env`（M0-T01 之后才会有这个文件），填写**后台模型渠道**：`DRAMATICER_BG_BASE_URL`、`DRAMATICER_BG_API_KEY`、`DRAMATICER_BG_MODEL`（推荐用一个 Gemini Flash 级别的公益站或中转渠道，**不要和你平时玩用的渠道是同一个**，避免互相抢限流额度）。另外再填一个正文渠道 `DRAMATICER_MAIN_*`，M1 会用到 | M0-T11、M1-T01 |
| HUMAN-02 | 部分完成（2026-11-06：key 已写入 `.env`，`/v1/models` 鉴权通过；所有 embedding 模型调用都返回 HTTP 402、code 30001「account balance is insufficient」，`BAAI/bge-m3`、`BAAI/bge-large-zh-v1.5`、`Qwen/Qwen3-Embedding-0.6B` 结果相同） | 不阻塞 | 给硅基流动账户充值后 `BAAI/bge-m3` 才可用；在此之前 M2 用 BM25 加实体检索的降级方案，embedding 接口留好位置 | 无 |
| HUMAN-03 | 待处理 | 不阻塞 | 抽查 `eval-private/evalset/spotcheck.md` 里的事件题（事件题的 20%），对照 `eval-private/raw/` 的对话原文核对问题、答案和证据楼层。发现错题直接在该文件里标注即可；这条不阻塞任何任务 | 无 |
| HUMAN-04 | 待处理 | 不阻塞 | 进行 M1-T01 时，如果希望验证 Gemini 原生协议，就提前启动本机的 gcli2api（端口 7861）；不启动的话这一项会被跳过 | M1-T01（部分） |
| HUMAN-05 | 已完成（2026-11-06：`.env` 的后台与正文模型都改成 `opendesign/deepseek-v4.1-flash`，经 magpie 网关实测 `/v1/chat/completions` 返回 200、2.5 秒） | 不阻塞 | 后台渠道 `antigravity/gemini-3.8-flash` 的账号已被上游停用（HTTP 403，违反服务条款）。M0-T11 的第三个对话已用环境变量临时改用 `auto/deepseek-v4.1-flash` 完成；请在 `.env` 里换一个可用的后台渠道和模型（也可以继续用 magpie 里的其他模型），不要提交 `.env` | 无 |
