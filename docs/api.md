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

## 6. 健康检查

### GET `/health/` · 公开（无需认证）

```jsonc
// 200
{ "status": "ok", "db": "ok", "version": "1.0.0" }
// 503
{ "status": "error", "db": "unreachable", "version": "1.0.0" }
```

用于 Docker healthcheck 与负载均衡探活。

---

## 7. 前端调用速查表

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
