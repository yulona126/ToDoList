---
name: todolist-plan
description: 把 ToDoList 工作区里的真实任务拉进当前项目，用于整理开发计划、梳理版本待办、导入/导出 TODO、评审里程碑进度，并把新拆出的工作写回 ToDoList；计划文档优先写入工作区 Document（kind=plan）；也可读写每工作区唯一的架构图（Mermaid）。也可把仓库里的本地 .md 导入为 Document。当用户说「整理开发计划」「把 todolist 导入」「把这个 md 导入 todolist」「导入计划文档」「看一下架构图」「更新架构图」「改任务描述」「更新任务优先级」「这个版本还剩什么」「生成 TODO」「同步待办」「plan the next milestone」「import my todos」或提到 todolist / 工作区 / 里程碑 / 计划文档 / 架构图时使用。依赖 todolist MCP 工具（list_workspaces、get_tasks、create_tasks、update_tasks、update_task、list_documents、get_document、upsert_document、get_architecture、upsert_architecture）。
---

# ToDoList 计划整理

把 ToDoList 当作这个项目的**唯一待办来源**，并把开发计划沉淀为工作区 **Document**（`kind=plan`）；架构说明用工作区唯一的 **Architecture**（Mermaid）。目标是：先读取真实数据，再把结果写回；计划产生新工作时，提议写回任务。

## 何时使用

- 「整理开发计划」「帮我理一下这个版本要做什么」
- 「把 todolist 导入」「拉一下我的待办」「同步一下工作区」
- 「这个版本还剩什么」「里程碑进度如何」「有哪些逾期」
- 「生成 TODO」「按清单拆成 TODO 列表」
- 「把计划存进 todolist」「更新计划文档」
- 「把这个 md 导入 todolist」「把 PLAN.md / docs/xxx.md 存成文档」
- 「看一下架构图」「更新 / 写入架构图」「把这段 Mermaid 存进 todolist」
- "plan the next milestone" / "import my todos" / "what's left for this release"

## 前置条件

`todolist` MCP server 必须已连接。若工具不可用，告诉用户：

1. 在 ToDoList 网页端「设置 → API Tokens」创建 token（明文只显示一次）；
2. 把 token 配到 `.cursor/mcp.json` 的 `TODOLIST_TOKEN`（或它引用的 envFile）；
3. 重启 / reload Cursor 的 MCP server。

不要用 shell + curl 绕过 MCP 去猜接口，也不要读取仓库里的任何 token 文件。

## 工作流

1. **`list_workspaces()`** 拿工作区列表。
   - 只有一个 → 直接用。
   - 多于一个且用户没说清 → **先问**「用哪个工作区？」，不要猜、不要合并多个工作区。
   - 用户提到的名字能唯一匹配某个工作区 → 直接用，并说明用的是哪个。
2. **`get_tasks(workspace_id=...)`** 读取任务。按需收窄：`status="todo,doing"`、`due="week"|"overdue"|"today"|"none"`、`search="关键词"`；确实需要看已完成项时才 `include_done=true`。
   - 结果已按清单分组、子任务缩进在父任务下，每行都带 `#id`。
   - 数据量大时按 `due` 或 `status` 分批读，别一次全量塞进上下文。
3. **查已有计划**：`list_documents(workspace_id, kind="plan")`。若已有目标计划，用 `get_document(document_id)` 读正文再改，不要盲目新建第二份。
4. **产出计划**：把读到的任务折进 Markdown 计划正文。
   - 保留 `#id`，例如「- [ ] #158 确定 PWA 缓存策略」。
   - 别把 `#id` 丢掉或改写——后续更新任务只能靠它。
   - 用户没要求的任务不要凭空补，缺信息就用已有字段（状态/优先级/类型/截止日/标签/清单）判断。
5. **写回 Document（默认）**：用 `upsert_document(workspace_id, title, body, kind="plan", document_id?)` 保存计划。
   - 已有对应文档 → 传 `document_id` 更新。
   - 没有 → 省略 `document_id` 新建；`title` 用清晰版本名，如「v1.2 里程碑计划」。
   - **先展示**将写入的标题与摘要，确认后再写。
   - 用户明确只要本地 Markdown / 只要对话回复时，可不写 Document，但要说明。
6. **导入本地 .md → Document**：用户给出仓库里的 Markdown 路径时：
   - 用 Cursor 读文件工具读取正文（**不要**让 MCP 去读磁盘；MCP 只打 ToDoList API）。
   - `list_workspaces` → `list_documents` 确认是否已有同名/同 path 文档。
   - `upsert_document(workspace_id, title, body=<文件全文>, kind=…, path=<相对路径>)`。
     - `title`：文件名去扩展名，或取文内第一个 `# 标题`。
     - `kind`：计划用 `plan`，笔记 `note`，决策 `decision`，规格 `spec`；不确定就问或默认 `plan`。
     - `path`：填仓库相对路径（如 `docs/plans/v1.md`），方便以后对照 git。
   - **先展示**将导入的 title / path / 正文摘要，确认后再写。
   - 大文件注意上下文：可以整篇写入；汇报时只摘要，不要把全文再贴回对话。
7. **架构图（每工作区唯一）**：
   - 读取：`get_architecture(workspace_id)` → 返回 title / preferred / Mermaid 源码（及是否有上传图片）。
   - 更新：`upsert_architecture(workspace_id, mermaid=…, title?=…, preferred?="mermaid"|"image")`。
   - 每个工作区只有一份；重复 upsert 是覆盖，不是新建第二份。
   - **先 `get_architecture` 再改**；展示将写入的 Mermaid 摘要，确认后再写。
   - MCP **不能**上传图片；图片请在网页端「架构图」页上传。MCP 只读写 Mermaid 文本。
   - 整理计划时若用户关心系统结构，可顺带 `get_architecture` 作上下文，但不要擅自改架构图。
8. **回写任务（可选）**：计划里出现 ToDoList 中不存在的新任务时，**先展示**打算创建什么，得到确认后再调 `create_tasks(workspace_id, tasks)`。
   - 每个 task：`title` 必填；可选 `description`、`task_list`、`priority`(low|medium|high|urgent)、`task_type`(dev|meeting|communication|design|research|other)、`due_date`(YYYY-MM-DD)、`tag_names`、`subtasks`。
   - `task_list` 用 `get_tasks` 输出里的 `list#<id>`；不确定就省略，任务会落到「未分组」。
9. **改任务字段**：用户要改描述 / 标题 / 优先级 / 类型 / 截止日 / 状态 / 所属清单时，用 `update_task(task_id, fields={...})`。
   - 只传要改的键，例如 `update_task(158, {"description": "…", "priority": "high"})`。
   - `due_date` 传 `""` 或 `null` 可清除；`task_list` 传 `null` 移到未分组。
   - **先展示**将改哪些字段，确认后再写；写完用返回摘要核对。
10. **批量状态回写**：用户说「这些做完了 / 归档」时，用 `update_tasks(task_ids=[...], action="done"|"todo"|"archive")`，并回报实际更新条数。不要用它改 description——那是 `update_task` 的职责。

## 硬性规则

- **绝不编造 task id、document id 或 workspace id。** 只使用工具返回过的 id；不确定就再读一次。
- **先读后写。** 任何写操作（创建/更新）前，先 `get_tasks` / `list_documents` / `get_architecture`（按需）确认现状，别凭对话记忆写。
- **工作区有歧义就问**，不要默认选第一个，也不要把多个工作区的任务混进同一份计划。
- **输出保留 id**，让后续的 `update_task` / `update_tasks` / `upsert_document` 能落到正确对象上。
- 写操作**先给用户看清单再执行**；批量操作说明影响范围（多少条、哪些 id）。
- 工具报错时把错误原文转述给用户（通常是 token 无效、工作区 id 不存在、清单/文档 id 不属于该工作区），不要静默重试或改用其他途径绕过。
- 引用任务时用「清单名 + #id + 标题」的简短形式；引用文档用「doc#id + 标题」。
