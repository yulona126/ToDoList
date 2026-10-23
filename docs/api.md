# ToDoList · API 契约 v1

Base URL：`/api/v1`　｜　鉴权：`Authorization: Bearer <access_token>`
OpenAPI 运行时文档：`/api/docs/`　｜　Schema：`/api/schema/`

> 本文档是前后端唯一契约。前端 `src/types/` 中的类型必须与本文一一对应。

---

## 0. 通用约定

### 0.1 分页

列表接口统一返回分页信封（`page_size` 默认 50，最大 200）：

```json
{ "count": 128, "next": "http://host/api/v1/tasks/?page=3", "previous": null, "results": [ /* ... */ ] }
```

请求参数：`?page=1&page_size=50`

### 0.2 错误体

```json
{ "detail": "人类可读的错误摘要", "errors": { "title": ["This field is required."] } }
```

| 状态码 | 含义 |
| --- | --- |
| 400 | 参数校验失败 |
| 401 | 未认证 / token 过期 |
| 403 | 无权限 |
| 404 | 资源不存在**或不属于当前用户**（避免存在性泄漏） |
| 429 | 限流（预留） |

### 0.3 时间与日期

- 时间戳：ISO 8601 UTC，如 `2026-02-11T07:30:00Z`（只读，服务端生成）
- 日期：`YYYY-MM-DD`，如 `2026-02-20`

### 0.4 枚举（前后端共有常量，前端须在 `constants.ts` 中镜像）

```
TaskStatus      : todo | doing | blocked | done
TaskPriority    : low | medium | high | urgent
TaskType        : dev | meeting | communication | design | research | other
WorkspaceVis    : private | shared
MemberRole      : owner | admin | member | viewer
DocumentKind    : plan | note | decision | spec
DocumentStatus  : draft | active | archived
```

---

## 1. 认证 `/auth`

### POST `/auth/register/` · 公开

```jsonc
// 请求
{ "email": "dev@example.com", "username": "dev", "password": "S3cret!pass", "password_confirm": "S3cret!pass" }
// 201
{ "user": { /* User */ }, "access": "eyJ...", "refresh": "eyJ..." }
```

约束：`email` 唯一且合法；`username` 唯一，2–32 字符；`password` ≥ 8 位且非纯数字（Django 强度校验）；
两次密码必须一致（否则 `errors.password_confirm`）。

### POST `/auth/login/` · 公开

```jsonc
// 请求 —— 使用 email 登录
{ "email": "dev@example.com", "password": "S3cret!pass" }
// 200
{ "user": { /* User */ }, "access": "eyJ...", "refresh": "eyJ..." }
// 401
{ "detail": "邮箱或密码不正确" }
```

### POST `/auth/refresh/` · 公开

```jsonc
{ "refresh": "eyJ..." }        // 200
{ "access": "eyJ...", "refresh": "eyJ..." }   // refresh 轮转，旧 refresh 进入黑名单
```

### POST `/auth/logout/` · 需认证

```jsonc
{ "refresh": "eyJ..." }        // 205 No Content
```

### GET `/auth/me/` · 需认证 → `User`

### PATCH `/auth/me/` · 需认证

可改：`username`、`display_name`（`email` 不可改）

### API Tokens `/auth/tokens` · 需认证

给 CLI / MCP / CI 用的**长期**凭据（JWT 的 access 只有 60 分钟，浏览器外不可用）。
详见 [mcp-and-skills.md](mcp-and-skills.md)。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/auth/tokens/` | 列出自己的 token（**永不返回明文**，只有 `prefix`） |
| `POST` | `/auth/tokens/` | 签发 → `{id, name, prefix, is_active, expires_at, created_at, token}`；**`token` 只在此响应出现一次** |
| `DELETE` | `/auth/tokens/{id}/` | 撤销（保留行以便审计 `last_used_at`） |

```jsonc
// POST 请求体
{ "name": "cursor-mcp", "expires_in_days": null }   // null / 省略 = 永久
// 201
{ "id": 1, "name": "cursor-mcp", "prefix": "tdl_ExAmPlE000", "is_active": true,
  "last_used_at": null, "expires_at": null, "created_at": "…",
  "token": "tdl_……" }
```

**认证**：`Authorization: Bearer tdl_…`（也接受 `Token tdl_…`）。

认证器按序尝试：不是 `tdl_` 前缀就交给 JWT，因此**网页端不受任何影响**。
服务端只存 SHA-256 摘要，明文无法找回。

### POST `/auth/password/change/` · 需认证

```jsonc
{ "old_password": "...", "new_password": "..." }   // 204；旧密码错误 → 400
```

### User 对象

```jsonc
{
  "id": 1,
  "email": "dev@example.com",
  "username": "dev",
  "display_name": "Dev",
  "name": "Dev",                       // 只读；display_name 为空时回退为 username
  "date_joined": "2026-02-11T07:30:00Z"
}
```

---

## 2. 工作区 `/workspaces`

### GET `/workspaces/`

查询参数：`?include_archived=false&ordering=sort_order,-created_at&search=`

```jsonc
{
  "count": 2, "next": null, "previous": null,
  "results": [{
    "id": 1,
    "name": "ToDoList v1",
    "description": "个人待办 PWA",
    "visibility": "private",
    "is_archived": false,
    "sort_order": 0,
    "created_at": "2026-02-11T07:30:00Z",
    "updated_at": "2026-02-11T07:30:00Z",
    "role": "owner",
    "stats": { "total": 24, "todo": 10, "doing": 5, "blocked": 2, "done": 7, "overdue": 3 }
  }]
}
```

### POST `/workspaces/`

```jsonc
{ "name": "ToDoList v1", "description": "可选", "sort_order": 0 }   // 201 → Workspace
```

副作用：自动创建 `WorkspaceMember(workspace, user, role=owner)`。
上限：单用户最多 50 个工作区（超出 → 400）。

### GET / PATCH / DELETE `/workspaces/{id}/`

- PATCH 可改 `name` / `description` / `sort_order` / `is_archived`
- DELETE → 204，**级联删除**其下 list / task / tag（二次确认由前端负责）

### GET `/workspaces/{id}/members/` · 只读（V1 预留）

```jsonc
{ "count": 1, "next": null, "previous": null,
  "results": [{ "id": 1, "user": { /* User */ }, "role": "owner", "joined_at": "2026-02-11T07:30:00Z" }] }
```

> V1 只会返回 owner 自己；接口形态已按共享语义固定，V1.1 直接复用。

### GET / PUT / DELETE `/workspaces/{id}/architecture/`

每个工作区**恰好一份**架构图（没有则 GET 返回空壳，`has_content=false`）。

```jsonc
// GET / PUT 响应
{
  "workspace": 1,
  "title": "系统架构",
  "mermaid": "flowchart LR\n  A --> B",
  "image_url": null,                 // 有上传图时为绝对 URL
  "preferred": "mermaid",            // mermaid | image
  "has_content": true,
  "created_at": "...", "updated_at": "..."
}

// PUT 请求（均可选，部分更新）
{ "title": "系统架构", "mermaid": "flowchart LR\n  A --> B", "preferred": "mermaid" }
```

DELETE → 204，清空 Mermaid 与图片。

### POST / DELETE `/workspaces/{id}/architecture/image/`

`multipart/form-data`，字段名 `image`；支持 png/jpg/webp/svg/gif，≤5MB。上传即替换（每工作区一张）。DELETE 只移除图片。

---

## 3. 清单 `/lists`

> `TaskList` 的中文界面名称为「清单 / 阶段」。

### GET `/lists/?workspace={id}` · `workspace` 必填

额外参数：`?include_archived=false&ordering=sort_order,created_at`

```jsonc
{ "count": 3, "next": null, "previous": null,
  "results": [{
    "id": 7, "workspace": 1, "name": "需求梳理", "description": "",
    "sort_order": 0, "is_archived": false,
    "created_at": "...", "updated_at": "...",
    "stats": { "total": 8, "done": 3 }
  }] }
```

### POST `/lists/`

```jsonc
{ "workspace": 1, "name": "需求梳理", "description": "", "sort_order": 0 }   // 201
```

### GET / PATCH / DELETE `/lists/{id}/`

DELETE → 204。该清单下的任务**不删除**，其 `task_list` 置为 `null`（落入「未分组」）。

### POST `/lists/reorder/`

```jsonc
{ "items": [{ "id": 7, "sort_order": 0 }, { "id": 8, "sort_order": 1 }] }   // 200 { "updated": 2 }
```

---

## 4. 任务 `/tasks`

### GET `/tasks/`

| 参数 | 说明 |
| --- | --- |
| `workspace` | **必填**，工作区 id |
| `task_list` | 清单 id；传 `null` 表示只看未分组 |
| `status` | 逗号分隔多值，如 `todo,doing` |
| `priority` | 逗号分隔多值 |
| `task_type` | 逗号分隔多值 |
| `tag` | 标签 id，逗号分隔多值（AND 语义） |
| `parent` | 传 `null` 只看顶层任务；传 id 看某任务的子任务；不传=全部 |
| `due` | `today` \| `week` \| `overdue` \| `none` |
| `search` | 对 `title`、`description` 做 icontains |
| `is_archived` | 默认 `false` |
| `ordering` | 默认 `sort_order,created_at`，可 `-due_date`、`-priority` 等 |

```jsonc
{
  "count": 24, "next": null, "previous": null,
  "results": [{
    "id": 101,
    "workspace": 1,
    "task_list": 7,
    "workspace_name": "ToDoList v1",
    "task_list_name": "需求梳理",
    "parent": null,
    "title": "确定 PWA 缓存策略",
    "description": "NetworkFirst 还是 StaleWhileRevalidate",
    "status": "doing",
    "priority": "high",
    "task_type": "research",
    "due_date": "2026-02-20",
    "completed_at": null,
    "sort_order": 0,
    "is_archived": false,
    "is_overdue": false,
    "tags": [{ "id": 3, "workspace": 1, "name": "pwa", "created_at": "..." }],
    "subtask_stats": { "total": 2, "done": 1 },
    "created_at": "...", "updated_at": "..."
  }]
}
```

> 列表返回**仅顶层字段**，不含 `subtasks` 内联数组（子任务通过 `?parent=<id>` 单独拉取，避免列表膨胀）。
> `is_overdue` 为服务端计算：`due_date < today AND status != done`。

### POST `/tasks/`

```jsonc
{
  "workspace": 1,
  "task_list": 7,            // 可省略 / null
  "parent": null,            // 可省略；传入则成为子任务（只允许一层）
  "title": "确定 PWA 缓存策略",
  "description": "",
  "status": "todo",
  "priority": "medium",
  "task_type": "dev",
  "due_date": "2026-02-20",
  "tag_ids": [3, 5]          // 写操作用 tag_ids；读返回 tags 对象数组
}
```

校验规则：

- `title` 必填，1–200 字符；
- `task_list` 必须属于同一 `workspace`；
- `parent` 必须属于同一 `workspace`，且 `parent.parent` 必须为空（禁止三层）；
- `status` 置为 `done` 时服务端自动写 `completed_at`；从 `done` 改回其他状态清空 `completed_at`。

### GET / PATCH / DELETE `/tasks/{id}/`

- PATCH 部分更新，接受上述所有字段 + `tag_ids`
- DELETE → 204；若有子任务，**级联删除子任务**（响应体 `{ "detail": "...", "deleted_subtasks": 2 }` 仅 admin 可见，前端无需处理）

### POST `/tasks/{id}/toggle/`

无请求体。`done ⇄ todo` 切换，返回更新后的 Task。用于复选框快捷操作。

### POST `/tasks/reorder/`

```jsonc
{ "items": [{ "id": 101, "sort_order": 0, "task_list": 7 }] }   // 200 { "updated": 1 }
```

### POST `/tasks/bulk/` · 批量操作

```jsonc
{ "ids": [101, 102], "action": "done" }        // action: done | todo | archive | delete
// 200 { "updated": 2 }
```

---

## 5. 标签 `/tags`

### GET `/tags/?workspace={id}` · `workspace` 必填

```jsonc
{ "count": 3, "next": null, "previous": null,
  "results": [{ "id": 3, "workspace": 1, "name": "pwa", "task_count": 4, "created_at": "..." }] }
```

### POST `/tags/`

```jsonc
{ "workspace": 1, "name": "pwa" }     // 201；同 workspace 内重名 → 400
```

### DELETE `/tags/{id}/` → 204（自动从任务上解绑）

---

## 5.1 文档 `/documents`

工作区原生 Markdown 文档（计划 / 笔记 / 决策 / 规格）。正文存库；可选 `path` 仅作仓库指针，不替代 git 文件。

### GET `/documents/?workspace={id}` · `workspace` 必填

| 参数 | 说明 |
| --- | --- |
| `workspace` | **必填**，工作区 id |
| `kind` | 逗号分隔：`plan` \| `note` \| `decision` \| `spec` |
| `status` | 逗号分隔：`draft` \| `active` \| `archived` |
| `tag` | 标签 id，逗号分隔（AND） |
| `search` | 对 `title`、`body` 做 icontains |
| `include_archived` | 默认 `false`（隐藏 `status=archived`） |
| `ordering` | 默认 `sort_order,-updated_at` |

```jsonc
{ "count": 2, "next": null, "previous": null,
  "results": [{
    "id": 3, "workspace": 1, "workspace_name": "ToDoList v1",
    "title": "v1 里程碑计划", "body": "- [ ] #158 确定缓存策略\n",
    "kind": "plan", "status": "active", "path": "",
    "sort_order": 1, "tags": [],
    "created_at": "...", "updated_at": "..."
  }] }
```

### POST `/documents/`

```jsonc
{ "workspace": 1, "title": "v1 里程碑计划", "body": "...", "kind": "plan",
  "status": "draft", "path": "", "tag_ids": [3] }   // 201
```

### GET / PATCH / DELETE `/documents/{id}/`

DELETE → 204。

---

## 6. AI 助手 `/ai` · 另见 [ai-assistant.md](ai-assistant.md)

全部需认证。API Key 由服务端加密保存，**接口永不返回明文**（只回 `key_mask`）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/ai/credential/` | → `{configured, provider, model, base_url, key_mask, is_active, models_available, tokens_used_today, daily_token_budget, last_verified_at, last_error}` |
| `PUT` | `/ai/credential/` | `{api_key?, provider?, model?, base_url?, is_active?}`；`api_key` 留空表示不改；首次配置必须提供 |
| `DELETE` | `/ai/credential/` | 204 |
| `POST` | `/ai/credential/test/` | `max_tokens=1` 的连通性探测 → `{ok, model, latency_ms}` |
| `POST` | `/ai/parse/` | 文本 → 任务草稿（见下） |
| `POST` | `/ai/split/` | `{task_id}` → `{subtasks:[{t}], usage, latency_ms}` |
| `GET` | `/ai/usage/?days=30` | token 账目 + `local_ratio`（本地解析占比） |

### POST `/ai/parse/`

```jsonc
// 请求
{ "workspace": 1, "text": "写登录页 @开发 #api !高 明天", "mode": "local" }
// mode: local(默认，只按标记) | ai(强制交给模型)   —— 见下方说明

// 200
{
  "source": "local",                       // local | ai
  "tasks": [{
    "t": "写登录页", "l": 7, "l_name": "开发",
    "p": "high", "y": null, "d": "2026-10-09",
    "g": [], "g_names": ["api"],           // g=已存在的标签 id；g_names=全部名字（未知的在确认时创建）
    "s": []                                // 子任务标题
  }],
  "warnings": [{ "code": "list_not_found", "message": "…", "value": "前端" }],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0, "total_tokens": 0 },
  "latency_ms": 0
}
```

`mode` 只有两个取值，语义互不重叠：

| 值 | 行为 | 成本 |
| --- | --- | --- |
| `local`（**默认**） | **只按标记识别**。无标记的整段文字 = 1 条任务，不拆分、不猜测 | 0 token |
| `ai` | **整段文本原样交给模型**，有标记也照样交 | 花 token |

错误：未配置 Key（仅 `mode=ai`）→ **400**；配额用尽 → **429**；上游失败 → **502**。

> `auto` 已移除，传它会得到 **400**。早期它按启发式自动升级到模型，
> 结果是没配 Key 时无标记文本返回 0 条任务。

### POST `/tasks/bulk-create/`

```jsonc
{ "tasks": [{ "workspace": 1, "task_list": 7, "title": "…", "priority": "high",
              "tag_names": ["api"], "subtasks": ["子任务一"] }] }
// 201 { "created": 2, "tasks": [ /* Task */ ] }
```

事务内批量创建（含子任务与按名新建标签）；任一条不合法则整体 400。

---

## 7. 健康检查

### GET `/health/` · 公开（无需认证）

```jsonc
// 200
{ "status": "ok", "db": "ok", "version": "1.0.0" }
// 503
{ "status": "error", "db": "unreachable", "version": "1.0.0" }
```

用于 Docker healthcheck 与负载均衡探活。

---

## 8. 前端调用速查表

| 场景 | 调用 |
| --- | --- |
| 注册 | `POST /auth/register/` |
| 登录 | `POST /auth/login/` |
| 恢复会话 | `localStorage.refresh` → `POST /auth/refresh/` → `GET /auth/me/` |
| 侧栏工作区列表 | `GET /workspaces/`（用 `stats` 显示徽标） |
| 工作区任务台 | `GET /workspaces/{id}/` + `GET /lists/?workspace=` + `GET /tasks/?workspace=&page_size=200` |
| 勾选完成 | `POST /tasks/{id}/toggle/` |
| 添加子任务 | `POST /tasks/` 带 `parent` |
| 展开子任务 | `GET /tasks/?workspace=&parent={id}` |
| 文档列表 / 编辑 | `GET /documents/?workspace=` · `POST/PATCH /documents/` |
| AI 录入 | `POST /ai/parse/` → 确认 → `POST /tasks/bulk-create/` |
| 本地标记录入 | `POST /ai/parse/`（`source: "local"`，0 token） |
