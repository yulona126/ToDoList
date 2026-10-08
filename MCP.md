# 在 Cursor 里使用 ToDoList（MCP 安装与使用指南）

> 装完之后，你在 Cursor 里说一句「**把这个版本的待办整理进开发计划**」，
> Cursor 就会自己把你的 ToDoList 工作区拉进来，写进当前的计划文档。

设计原理与安全边界见 [docs/mcp-and-skills.md](docs/mcp-and-skills.md)；
本文只讲**怎么装、怎么用、坏了怎么修**。

---

## 目录

1. [它能做什么](#1-它能做什么)
2. [前置条件](#2-前置条件)
3. [安装（4 步）](#3-安装4-步)
4. [日常怎么用](#4-日常怎么用)
5. [四个工具](#5-四个工具)
6. [排错](#6-排错)
7. [更新与卸载](#7-更新与卸载)
8. [安全须知](#8-安全须知)

---

## 1. 它能做什么

装好后，你在 Cursor 里用自然语言提需求即可：

| 你说 | Cursor 会做 |
| --- | --- |
| 「整理一下这个版本的开发计划」 | 拉取任务 → 按清单折进计划文档 |
| 「把 todolist 导入这个项目」 | 生成 `TODO.md` |
| 「这个版本还剩什么没做」 | 拉取未完成任务 → 汇报 |
| 「把这几条加进 todolist」 | 写回你的工作区 |
| 「这几个做完了，标记一下」 | 批量改状态 |

**数据方向是双向的**：既能拉进项目，也能把 Cursor 里讨论出的新事项写回 ToDoList。

---

## 2. 前置条件

| 需要 | 检查命令 | 说明 |
| --- | --- | --- |
| ToDoList 正在运行 | `curl -s localhost:8001/api/v1/health/` | 应返回 `{"status":"ok",...}` |
| 本仓库路径 | `cd /path/to/ToDoList && pwd` | 下文用 `$REPO` 指代 |
| Python 3.10+ | `python3 -V` | 仅用于跑 MCP server |
| Cursor | — | 需要支持 MCP 的版本 |

```bash
export REPO=/Users/yulon/code/ToDoList    # ← 改成你的实际路径
```

> 如果 ToDoList 没在跑：`cd "$REPO" && docker compose up -d`

---

## 3. 安装（4 步）

### 第 1 步 · 建一个 Python 环境给 MCP server

MCP server 需要官方 `mcp` SDK，装在一个独立 venv 里：

```bash
python3 -m venv "$REPO/mcp/.venv"
"$REPO/mcp/.venv/bin/pip" install -r "$REPO/mcp/requirements.txt"
# 或者： "$REPO/mcp/.venv/bin/pip" install "mcp==2.3.0"
```

> 本仓库已经有一个可用的 `mcp/.venv`，如果它还在，这一步可以跳过。
> 安装脚本会自动优先使用它。

### 第 2 步 · 在网页上创建 Token

打开 **http://localhost:8081** → 右上角头像 → **设置** → 找到 **API Tokens** 区块 →
点 **新建 Token**，名字填 `cursor-mcp`，有效期选「永不过期」。

**明文只显示这一次**，点复制后立刻粘到下一步。丢了就撤销重建。

> 这个 token 就是 Cursor 访问你数据的钥匙，等同于一个已登录的你。
> 服务端只存 SHA-256 摘要，无法找回。

### 第 3 步 · 装进你的项目

```bash
cd "$REPO"
./scripts/install-cursor-integration.sh ~/code/你的项目
```

它做三件事：

1. 复制 skill 到 `<项目>/.cursor/skills/todolist-plan/SKILL.md`
2. 写入/合并 `<项目>/.cursor/mcp.json`（**合并**，你原有的其它 MCP server 不会被覆盖）
3. 打印后续步骤

安装脚本是**幂等**的，重复跑只会刷新，不会重复添加。
它**不碰 token**——token 由你手动填。

> 忘了建 venv 也能跑，脚本会退回用 `python3` 并警告。但那样 MCP server
> 会因为找不到 `mcp` 包启动失败，所以第 1 步别省。

### 第 4 步 · 把 token 交给 Cursor

`mcp.json` 里**不写 token**，而是引用一个环境文件：

```bash
mkdir -p ~/.config/todolist && chmod 700 ~/.config/todolist
echo 'TODOLIST_TOKEN=tdl_你的token' > ~/.config/todolist/mcp.env
chmod 600 ~/.config/todolist/mcp.env
```

然后在 Cursor 里 **Reload Window**（`Cmd/Ctrl+Shift+P` → `Reload Window`），
或在 **Customize → MCP** 里把 `todolist` 开关关掉再打开。

**验证**：在 Cursor 里问「我有哪些工作区」。它应该调用 `list_workspaces` 并列出你的工作区。

---

## 4. 日常怎么用

### 拉进项目

```
你：用 todolist 里 PowerArena 这个版本的任务，帮我整理一份开发计划写到 PLAN.md
Cursor：[调用 list_workspaces → get_tasks] → 生成 PLAN.md
```

写进文件的计划里会带上任务 id（如 `#152`），方便后续更新。

### 写回 ToDoList

```
你：把刚才 PLAN.md 里拆出来的这 5 条加到 todolist 的「开发」清单
Cursor：[调用 create_tasks] → 已在工作区 4 创建 5 条任务
```

### 标记完成

```
你：152 和 156 做完了
Cursor：[调用 update_tasks([152,156], "done")] → 标记完成：更新 2 条
```

### 手动指定 skill

在 Cursor 对话框里输入 `/`，可以搜索到 `todolist-plan` 手动触发；
也可以 `@` 引用 `SKILL.md`。

---

## 5. 四个工具

| 工具 | 参数 | 作用 |
| --- | --- | --- |
| `list_workspaces` | — | 列出所有工作区 + 任务计数（含已归档，标 `[已归档]`） |
| `get_tasks` | `workspace_id`, `status?`, `due?`, `include_done?`, `search?` | **主工具**，返回紧凑 Markdown |
| `create_tasks` | `workspace_id`, `tasks[]` | 批量创建，`tasks` 支持 `title` / `task_list` / `priority` / `task_type` / `due_date` / `tag_names` / `subtasks` |
| `update_tasks` | `task_ids[]`, `action` | `action` ∈ `done` \| `todo` \| `archive` |

`get_tasks` 的返回长这样：

```markdown
# PowerArena:2026-09 (id=4) · 4 项

## 未分组 · 4 项
- [ ] #152 参加 howto text 会 · 中 · 会议 · 10-13
- [ ] #153 real time 与 playback 均显示 ROI · 中 · 开发
  - [ ] #154 支持手动隐藏部分 ROI · 中 · 开发
  - [ ] #155 等 joy 完成整合后接入 · 中 · 开发
- [ ] #156 接入 library 页面 · 中 · 开发
```

刻意用 Markdown 而不是 JSON：**同样的信息，JSON 大约多花 30–40% token**。
任务 id 一定带上，因为后续 `update_tasks` 要用它。

> 工具只有 4 个也是刻意的——工具定义本身占用模型上下文。

---

## 6. 排错

### 6.1 Cursor 里看不到 `todolist`

```bash
# 1) JSON 语法
python3 -m json.tool < ~/code/你的项目/.cursor/mcp.json

# 2) 位置对不对（必须是 <项目>/.cursor/mcp.json）
ls -l ~/code/你的项目/.cursor/mcp.json

# 3) 看 Cursor 的 MCP 日志：Customize → MCP → todolist → 查看输出
```

### 6.2 手工验证 server 能不能起来

绕开 Cursor，直接跑一次：

```bash
TODOLIST_TOKEN=$(sed -n 's/^TODOLIST_TOKEN=//p' ~/.config/todolist/mcp.env) \
TODOLIST_API_URL=http://localhost:8001/api/v1 \
PYTHONPATH="$REPO/mcp" \
"$REPO/mcp/.venv/bin/python" -m todolist_mcp
```

正常表现：**没有输出，一直挂着等 stdin**（stdio 协议本来就不打印东西）。
按 `Ctrl+C` 退出。

报 `No module named todolist_mcp` → 少了 `PYTHONPATH`。
报 `ModuleNotFoundError: mcp` → venv 没装依赖，回到第 1 步。

### 6.3 工具报「TODOLIST_TOKEN 未设置 / 配置错误」

token 没传进去。检查：

```bash
cat ~/.config/todolist/mcp.env        # 格式必须是 TODOLIST_TOKEN=tdl_xxx
```

注意 `mcp.env` 里**不要**加引号，也不要有多余空格。

### 6.4 工具报 401

token 被撤销了、拷漏字符、或前后带空格。到 **设置 → API Tokens** 重新签发一个。

### 6.5 工具全部失败，但 `curl` 明明正常 ⚠️

**这是本机最容易踩的坑。** 如果你开着代理（比如 Clash / Surge 监听 `127.0.0.1:7897`），
macOS 的 `urllib` 会**自动合并系统代理设置**，于是发往 `localhost` 的请求被塞进代理，
返回 **502 Bad Gateway**，而 `curl` 却一切正常。

MCP server 已经处理了这个问题（只认 `http_proxy` / `https_proxy` / `no_proxy`
这三个环境变量，忽略系统代理）。如果你仍然遇到，临时清掉代理变量：

```bash
unset http_proxy https_proxy all_proxy
```

### 6.6 改了 token 不生效

Cursor 缓存了 MCP 进程。**Reload Window**。

### 6.7 常见错误速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `No module named todolist_mcp` | 缺 `PYTHONPATH` | 重跑安装脚本（它会写入） |
| `ModuleNotFoundError: mcp` | venv 缺依赖 | `mcp/.venv/bin/pip install -r mcp/requirements.txt` |
| 连接被拒 | 后端没起 / 端口错 | `curl http://localhost:8001/api/v1/health/` |
| `401 API Token 无效` | token 撤销 / 抄错 | 重新签发 |
| `资源不存在（404）` | workspace_id 不对 | 先让 Cursor 调 `list_workspaces` |
| Cursor 里没这个 server | `mcp.json` 位置或语法错 | 见 6.1 |

---

## 7. 更新与卸载

### 更新

```bash
cd "$REPO" && git pull
"$REPO/mcp/.venv/bin/pip" install -r "$REPO/mcp/requirements.txt"
./scripts/install-cursor-integration.sh ~/code/你的项目   # 刷新 skill 与 mcp.json
```

然后 Reload Cursor。

### 卸载

```bash
# 1) 从项目里移除
rm -rf ~/code/你的项目/.cursor/skills/todolist-plan
# 从 .cursor/mcp.json 里删掉 "todolist" 这一段（保留其它 server）

# 2) 撤销 token（重要！）
#    网页 → 设置 → API Tokens → 对应那行点「撤销」

# 3) 删除本地凭据
rm -f ~/.config/todolist/mcp.env
```

> **撤销 token 这一步别忘。** 只删配置文件的话，那个 token 仍然是有效的。

---

## 8. 安全须知

- **Token 等同于一个已登录的你。** 别贴到聊天、issue、截图里。
- **`~/.config/todolist/mcp.env` 要 `chmod 600`**，且不要提交进任何仓库。
- **别把 token 直接写进项目的 `.cursor/mcp.json`**——除非你确认它已被 gitignore。
  默认方案用 `envFile` 就是为了避免这件事。
- **MCP server 不直连数据库**，所有读写都走 REST API，权限和网页端完全一致，
  跨用户访问仍然是 404。
- **`create_tasks` / `update_tasks` 会真的改数据。** 让 Cursor 写回前先看一眼它要建什么。
- 怀疑泄露：**设置 → API Tokens → 撤销**，立刻失效。

---

## 附：容器方式（可选）

不想在本机装 Python 依赖的话，MCP server 也可以跑在容器里：

```bash
cd "$REPO"
docker compose --profile tools build mcp
```

然后把 `.cursor/mcp.json` 里的 `todolist` 换成：

```json
{
  "mcpServers": {
    "todolist": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--network", "todolist_net",
               "-e", "TODOLIST_API_URL=http://backend:8000/api/v1",
               "-e", "TODOLIST_TOKEN",
               "todolist-mcp:latest"],
      "env": { "TODOLIST_TOKEN": "tdl_你的token" }
    }
  }
}
```

> ⚠️ 容器方式**尚未实测**（本机沙箱无法构建该镜像）。
> 本机 Python 方式是完整验证过的，建议先用它跑通。
