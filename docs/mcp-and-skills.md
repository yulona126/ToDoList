# ToDoList · Cursor 集成（MCP + Agent Skill）

> 📘 **只想照着步骤装？看 [MCP.md](../MCP.md)** —— 那份是操作指南；本文讲设计原理与取舍。
>
> 目标场景：在 Cursor 里说「**把这个版本的待办整理进开发计划**」，
> Cursor 自己调用 MCP 把你的 ToDoList 工作区拉进来，写进当前的计划文档。

---

## 1. 整体结构

```
┌──────────────────────────────────────────────┐
│ Cursor Agent                                 │
│  ├─ Skill: todolist-plan                    │  决定「什么时候」用
│  └─ MCP client ──stdio──► todolist-mcp      │  决定「怎么」用
└──────────────────────────────┬───────────────┘
                               │ HTTP + Bearer tdl_…
                               ▼
                    Django REST API (/api/v1)
                               │
                               ▼
                          PostgreSQL
```

**关键设计：MCP server 不碰数据库。** 它只是一个 REST 客户端。
所以权限、用户隔离、字段校验、审计与网页端**完全同一套代码**——
在 Cursor 里能看到的，和你在浏览器里能看到的，永远一致。

这也是为什么需要下面这个新东西。

---

## 2. 为什么必须有 API Token

浏览器里用的是 JWT：`access` 60 分钟过期，`refresh` 每次使用都会轮换并拉黑旧的。
这套机制在浏览器里很合适，但一个躺在 Cursor 配置里、每次开新会话都要用的命令行程序没法用。

所以新增 **Personal Access Token (PAT)**：

| 特性 | 说明 |
| --- | --- |
| 格式 | `tdl_` + 43 字符 URL-safe 随机串 |
| 存储 | 服务端只存 **SHA-256 摘要**，明文只在创建时返回一次 |
| 有效期 | 默认永久，可选 1–3650 天 |
| 撤销 | 设置页随时撤销（保留记录，便于审计 `last_used_at`） |
| 传输 | `Authorization: Bearer tdl_…`（也接受 `Token tdl_…`） |
| 与其他认证共存 | 认证器按顺序尝试；不是 `tdl_` 开头就交给 JWT，网页端零影响 |

> 为什么不明文存：数据库被读走 ≠ token 可用。
> 为什么不做加盐慢哈希：token 本身是 256 位随机数，不可爆破，
> 而每次请求都要做**一次索引等值查询**，慢了会拖垮所有接口。

---

## 3. 三步安装

### 第 1 步 · 创建 Token

浏览器打开 **http://localhost:8081** → 右上角头像 → **设置** → **API Tokens** → 新建，
名字写 `cursor-mcp`。

**明文只显示这一次**，立刻复制。丢了就撤销重建。

命令行等价做法：

```bash
curl -X POST http://localhost:8001/api/v1/auth/tokens/ \
  -H "Authorization: Bearer <你的 JWT 或已有 token>" \
  -H 'Content-Type: application/json' \
  -d '{"name":"cursor-mcp"}'
# → {"id":1,"name":"cursor-mcp","prefix":"tdl_ExAmPlE000","token":"tdl_……", ...}
```

### 第 2 步 · 装进你的项目

```bash
cd /path/to/ToDoList
./scripts/install-cursor-integration.sh ~/code/你的项目
```

它会：

- 把 skill 复制到 `<项目>/.cursor/skills/todolist-plan/`
- 写入/合并 `<项目>/.cursor/mcp.json`（**合并**，不会覆盖你已有的其它 MCP server）
- 打印后续步骤

### 第 3 步 · 给 Cursor 那把钥匙

`mcp.json` 里**不写 token**，而是通过环境变量传入。两种方式：

**A. 写进一个不进版本库的环境文件（推荐，所有项目共用）**

```bash
mkdir -p ~/.config/todolist
echo 'TODOLIST_TOKEN=tdl_你的token' > ~/.config/todolist/env
echo 'TODOLIST_API_URL=http://localhost:8001/api/v1' >> ~/.config/todolist/env
chmod 600 ~/.config/todolist/env
```

`mcp.json` 用 `envFile` 指向它：

```json
{
  "mcpServers": {
    "todolist": {
      "command": "python",
      "args": ["-m", "todolist_mcp"],
      "cwd": "/path/to/ToDoList/mcp",
      "envFile": "${HOME}/.config/todolist/env"
    }
  }
}
```

**B. 直接写进 `env`（简单，但 token 会留在项目文件里）**

```json
"env": { "TODOLIST_TOKEN": "tdl_…", "TODOLIST_API_URL": "http://localhost:8001/api/v1" }
```

> 若用 B，务必确认 `.cursor/mcp.json` 已被 gitignore，否则 token 会进版本库。

改完在 Cursor 里重新加载 MCP（`Cmd/Ctrl+Shift+P` → `Reload Window`，
或在 Customize → MCP 里点刷新）。连上后 Cursor 会列出 `todolist` 提供的 4 个工具。

---

## 4. 暴露的四个工具

工具描述本身也占用模型上下文，所以刻意只留 4 个。

| 工具 | 作用 | 典型调用时机 |
| --- | --- | --- |
| `list_workspaces()` | 列出所有工作区 + 任务计数 | 每次会话第一步，用来确定 workspace_id |
| `get_tasks(workspace_id, status?, due?, include_done?, search?)` | **主工具**。返回紧凑 Markdown，按清单分组，含任务 id | 拉取要写进计划的内容 |
| `create_tasks(workspace_id, tasks[])` | 批量创建（支持 `tag_names`、`subtasks`） | 计划里产生了新事项，写回 ToDoList |
| `update_tasks(task_ids[], action)` | `done` / `todo` / `archive` | 计划整理完，把完成的划掉 |

`get_tasks` 的输出形如：

```markdown
## 开发 (3)
- [ ] #12 实现子任务嵌套约束 · 紧急 · 开发 · 10-09 · #api
- [ ] #15 JWT 静默刷新 · 高 · 开发 · 10-13
  - [ ] #16 对比 Workbox handler 失效行为
  - [x] #17 写缓存决策记录
- [x] #18 docker compose 打通 · 高 · 10-07 · #docker

## 未分组 (1)
- [ ] #21 确认服务器时区为 Asia/Shanghai
```

刻意用 Markdown 而不是 JSON：**同样的信息，JSON 大约多花 30–40% token**，
而模型读 Markdown 完全不吃力。任务 id 一定带上，因为后续 `update_tasks` 要用。

---

## 5. Skill：让它知道「什么时候」用

`integrations/cursor/skills/todolist-plan/SKILL.md`

Skill 和 MCP 是两件事：

- **MCP** 提供*能力*（有哪些工具、怎么调）
- **Skill** 提供*判断*（什么情况下该调、调用顺序、有哪些禁忌）

没有 skill，模型经常不知道该用这些工具；有了 skill，你只要说人话：

| 你说 | 会发生什么 |
| --- | --- |
| 「整理一下这个版本的开发计划」 | 拉取任务 → 按清单写进计划文档 |
| 「把 todolist 导入这个项目」 | `list_workspaces` → 生成 `TODO.md` |
| 「这个版本还剩什么没做」 | `get_tasks(status=todo,doing)` → 汇报 |
| 「把这几条加进 todolist」 | `create_tasks` 写回 |

Skill 里明确写了几条硬规则：

- **绝不臆造任务 id** —— id 只能来自 `get_tasks` 的返回
- **先读后写** —— 不在没有 `list_workspaces` 的情况下猜 workspace_id
- **含糊就问** —— 多个工作区时先问用户，不擅自选
- 输出里保留任务 id，方便后续更新

Skill 目录（已按 Cursor 官方约定核对）：

```
.cursor/skills/todolist-plan/SKILL.md     ← 项目级，随仓库走
~/.cursor/skills/…                        ← 用户级，所有项目可用
```

frontmatter 必须是：

```yaml
---
name: todolist-plan        # 只能小写字母/数字/连字符，且必须等于文件夹名
description: 做什么 + 什么时候用
---
```

> Cursor 也会从 `.agents/skills/`、`.claude/skills/`、`.codex/skills/` 加载，
> 所以同一个 skill 也能给 Claude Code / Codex 用。

---

## 6. 运行方式

### A. 在容器里跑（零依赖，推荐）

MCP server 打成一个独立镜像 `todolist-mcp`（compose 里挂在 `tools` profile 下，
默认 `docker compose up` **不会**启动它）：

```bash
docker compose --profile tools build mcp
```

`mcp.json`：

```json
{
  "mcpServers": {
    "todolist": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--network", "todolist_net",
               "-e", "TODOLIST_API_URL=http://backend:8000/api/v1",
               "-e", "TODOLIST_TOKEN",
               "todolist-mcp:latest"],
      "env": { "TODOLIST_TOKEN": "tdl_…" }
    }
  }
}
```

好处：不需要在本机装 Python 依赖，和你的「一条 compose 起全栈」保持一致。

### B. 在本机跑

```bash
cd mcp
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export TODOLIST_API_URL=http://localhost:8001/api/v1
export TODOLIST_TOKEN=tdl_…
python -m todolist_mcp        # stdio，正常情况不会有输出
```

---

## 7. 安全边界

| 项 | 处理 |
| --- | --- |
| Token 明文 | 只在创建响应里出现一次；服务端只存 SHA-256 |
| Token 进版本库 | `mcp.json` 默认用 `envFile`；安装脚本会提示检查 gitignore |
| 权限范围 | 就是该用户自己的数据，**不多给一分**。跨用户访问仍是 404 |
| 越权写 | `create_tasks` 走 `/tasks/bulk-create/`，工作区归属照样校验 |
| MCP server 直连库 | **不做**。只走 REST，避免绕过业务规则 |
| 审计 | `last_used_at`（每分钟最多写一次，避免每请求一次写） |
| 撤销 | 设置页一键撤销，立即失效 |

> MCP server 拿到的能力 = 一个已登录的你。**别把 token 给别人，
> 也别把它塞进会提交的配置文件。**

---

## 8. 排错

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Cursor 里看不到 `todolist` 工具 | `mcp.json` 位置或 JSON 语法错 | 应在 `<项目>/.cursor/mcp.json`；`python -m json.tool < .cursor/mcp.json` 验证 |
| 工具报 `TODOLIST_TOKEN 未设置` | 环境变量没传进去 | 用 `envFile`，或确认 `env` 里确实有 |
| `401 API Token 无效` | token 撤销了 / 拷漏字符 / 前后有空格 | 设置页重新签发 |
| 连接被拒 | 后端没起，或 `TODOLIST_API_URL` 端口错 | `curl $TODOLIST_API_URL/health/` |
| 容器方式连不上 | 容器不在同一个 docker network | 用文档里的 `--network todolist_net` 与 `http://backend:8000` |
| 改了 token 不生效 | Cursor 缓存了 MCP 进程 | Reload Window |

自检（不经过 Cursor，直接验 token 和数据）：

```bash
TOK=$(cat ~/.config/todolist/env | sed -n 's/^TODOLIST_TOKEN=//p')
curl -s http://localhost:8001/api/v1/workspaces/ -H "Authorization: Bearer $TOK" | python3 -m json.tool
```

---

## 9. 与 AI 录入的关系

两者互补，不重叠：

| | AI 录入（应用内） | MCP（Cursor 内） |
| --- | --- | --- |
| 方向 | 文本 → 任务 | 任务 → 你的代码/计划 |
| 触发 | 你在网页上点「用 AI 分析」 | 你在 Cursor 里提需求 |
| 模型 | DeepSeek（服务端调用） | Cursor 自己的模型 |
| Token 成本 | DeepSeek 计费 | 计入 Cursor 订阅 |

典型闭环：**在 Cursor 里讨论出的方案 → 用 MCP `create_tasks` 写回 ToDoList →
换台机器打开网页勾进度 → 下次开会话再用 `get_tasks` 拉回来。**
