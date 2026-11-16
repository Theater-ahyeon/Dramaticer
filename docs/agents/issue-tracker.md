# 工单存放方式：本地 Markdown

本仓库的规格与工单都是 `.scratch/` 下的 Markdown 文件，随仓库提交。

## 约定

- 一个功能一个目录：`.scratch/<功能>/`
- 规格是 `.scratch/<功能>/spec.md`
- 工单一张一个文件：`.scratch/<功能>/issues/<NN>-<slug>.md`，从 `01` 编号，不合并成一个文件
- 每张工单靠前的位置有两行：`Blocked by:`（依赖的工单，跨功能时写 `<功能>/<NN>`）与 `Status:`
- `Status` 取值：`ready-for-agent`（可以做）、`claimed`（有人在做）、`done`（做完）
- 讨论与完成说明追加在文件末尾的 `## Comments` 下
- 总览与推荐顺序在 `.scratch/README.md`；暂缓的事项在 `.scratch/PARKED.md`

## 技能说「发布到 issue tracker」时

在 `.scratch/<功能>/` 下新建文件，并在 `.scratch/README.md` 里登记。

## 技能说「取某张工单」时

读对应路径的文件。人通常会直接给出路径或「功能/编号」。

## 可以做的工单（frontier）

`Status: ready-for-agent`，并且 `Blocked by` 里列出的每一张都是 `done`。按 `.scratch/README.md` 的顺序取第一张。
