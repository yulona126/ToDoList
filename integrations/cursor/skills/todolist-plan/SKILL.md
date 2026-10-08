---
name: todolist-plan
description: 把 ToDoList 工作区里的真实任务拉进当前项目，用于整理开发计划、梳理版本待办、导入/导出 TODO、评审里程碑进度，并把新拆出的工作写回 ToDoList。当用户说「整理开发计划」「把 todolist 导入」「这个版本还剩什么」「生成 TODO」「同步待办」「plan the next milestone」「import my todos」或提到 todolist / 工作区 / 里程碑时使用。依赖 todolist MCP 工具（list_workspaces、get_tasks、create_tasks、update_tasks）。
---

# ToDoList 计划整理

把 ToDoList 当作这个项目的**唯一待办来源**。目标是：先读取真实数据，再把结果折进用户要的计划文档/回答里；计划产生新工作时，提议写回 ToDoList。

## 何时使用

- 「整理开发计划」「帮我理一下这个版本要做什么」
- 「把 todolist 导入」「拉一下我的待办」「同步一下工作区」
- 「这个版本还剩什么」「里程碑进度如何」「有哪些逾期」
- 「生成 TODO」「按清单拆成 TODO 列表」
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
3. **产出计划**：把读到的任务折进用户要的产物（Markdown 计划文档、里程碑拆解、周计划、进度汇报）。
   - 保留 `#id`，例如「- [ ] #158 确定 PWA 缓存策略」。
   - 别把 `#id` 丢掉或改写——后续更新任务只能靠它。
   - 用户没要求的任务不要凭空补，缺信息就用已有字段（状态/优先级/类型/截止日/标签/清单）判断。
4. **回写（可选）**：计划里出现 ToDoList 中不存在的新任务时，**先展示**打算创建什么，得到确认后再调 `create_tasks(workspace_id, tasks)`。
   - 每个 task：`title` 必填；可选 `task_list`、`priority`(low|medium|high|urgent)、`task_type`(dev|meeting|communication|design|research|other)、`due_date`(YYYY-MM-DD)、`tag_names`、`subtasks`。
   - `task_list` 用 `get_tasks` 输出里的 `list#<id>`；不确定就省略，任务会落到「未分组」。
5. **状态回写**：用户说「这些做完了 / 归档」时，用 `update_tasks(task_ids=[...], action="done"|"todo"|"archive")`，并回报实际更新条数。

## 硬性规则

- **绝不编造 task id 或 workspace id。** 只使用工具返回过的 id；不确定就再读一次。
- **先读后写。** 任何写操作（创建/更新）前，先 `get_tasks` 确认现状，别凭对话记忆写。
- **工作区有歧义就问**，不要默认选第一个，也不要把多个工作区的任务混进同一份计划。
- **输出保留 id**，让后续的 `update_tasks` 能落到正确任务上。
- 写操作**先给用户看清单再执行**；批量操作说明影响范围（多少条、哪些 id）。
- 工具报错时把错误原文转述给用户（通常是 token 无效、工作区 id 不存在、清单 id 不属于该工作区），不要静默重试或改用其他途径绕过。
- 引用任务时用「清单名 + #id + 标题」的简短形式，不要贴大段 JSON。
