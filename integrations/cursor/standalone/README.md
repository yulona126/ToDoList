# ToDoList · Cursor MCP 安装包

把本包放到任意机器，运行 `install.sh`，即可在 Cursor 里调用 ToDoList 的 MCP 工具
（列出工作区、拉取/创建/更新任务）。**不需要完整仓库。**

## 需要什么

| 项 | 说明 |
| --- | --- |
| Python 3.10+ | 仅用于跑本地 MCP 进程 |
| Cursor | 支持 MCP 的版本 |
| 可达的 ToDoList API | 本机 / 局域网 / Tunnel 均可 |
| API Token | 在网页「设置 → API Tokens」创建 |

## 安装（3 步）

### 1. 解压并安装到你的项目

```bash
unzip todolist-cursor-mcp.zip
cd todolist-cursor-mcp

# 把 API 指到你打开网页时用的那个地址（同域走 /api/v1）
export TODOLIST_API_URL='https://你的ToDoList域名或IP/api/v1'
# 本机直连后端也可以：
# export TODOLIST_API_URL='http://localhost:8001/api/v1'

./install.sh ~/code/你的项目
```

脚本会：

1. 在本包内创建 `.venv` 并安装 `mcp` SDK  
2. 复制 skill → `<项目>/.cursor/skills/todolist-plan/`  
3. 合并写入 `<项目>/.cursor/mcp.json`（不覆盖其它 MCP）

### 2. 写入 Token

```bash
mkdir -p ~/.config/todolist && chmod 700 ~/.config/todolist
echo 'TODOLIST_TOKEN=tdl_你的token' > ~/.config/todolist/mcp.env
chmod 600 ~/.config/todolist/mcp.env
```

### 3. Reload Cursor

`Cmd/Ctrl+Shift+P` → **Reload Window**，或在 **Settings → MCP** 里开关 `todolist`。

验证：对 Cursor 说「我有哪些工作区」。

## 仅安装 Skill

如果不需要 MCP，只想要计划整理约定：

```bash
mkdir -p ~/code/你的项目/.cursor/skills
cp -R skills/todolist-plan ~/code/你的项目/.cursor/skills/
```

没有 MCP 时 skill 无法真正读写 ToDoList。

## 包内结构

```
todolist-cursor-mcp/
├── install.sh
├── README.md
├── mcp.env.example
├── mcp/                 # MCP server 源码
│   ├── todolist_mcp/
│   ├── requirements.txt
│   └── pyproject.toml
└── skills/
    └── todolist-plan/
        └── SKILL.md
```

把解压目录留在一个固定路径（例如 `~/.local/share/todolist-mcp`），
`mcp.json` 里的 python 路径会指向这里的 `.venv`。
