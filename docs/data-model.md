# ToDoList · 数据模型说明

数据库：PostgreSQL 17 ｜ ORM：Django 5.2 ｜ 迁移：`apps/*/migrations/0001_initial.py`

---

## 1. 关系总览

```
┌──────────┐        ┌───────────────┐        ┌───────────┐        ┌────────┐
│  User    │1      *│   Workspace   │1      *│  TaskList │1      *│  Task  │
│          ├────────┤  (项目/版本)   ├────────┤  (清单)    ├────────┤ (任务) │
└────┬─────┘  owner └───────┬───────┘        └───────────┘        └───┬────┘
     │                      │1                                       │
     │                      │                                        │ self
     │              ┌───────┴────────┐      ┌────────┐               │1:N
     │              │ WorkspaceMember│      │  Tag   │* ─ ─ ─ ─ ─ ─ ─┤
     │1            *│  (V1 预留)      │      └────────┘   M:N (tags)  │
     └──────────────┤  role/invited  │                               │
        workspace_  └────────────────┘                        ┌──────┴──────┐
        memberships                                          │   Task      │
                                                             │  (subtask)  │
                                                             └─────────────┘
```

---

## 2. `accounts.User`

自定义用户模型，**email 作为登录标识**（`USERNAME_FIELD = "email"`）。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | BigAutoField | PK | |
| `email` | EmailField | unique, indexed | 登录名；入库前统一转小写 |
| `username` | CharField(32) | unique, indexed | 公开标识，仅允许字母数字 `_` `-` |
| `display_name` | CharField(64) | blank | 界面展示名，注册时默认取 username |
| `password` | CharField(128) | | PBKDF2-SHA256 哈希 |
| `is_active` | BooleanField | default True | |
| `is_staff` | BooleanField | default False | 决定能否登录 admin |
| `is_superuser` | BooleanField | default False | |
| `date_joined` | DateTimeField | default now | |
| `last_login` | DateTimeField | null | 由 SimpleJWT `UPDATE_LAST_LOGIN` 维护 |

**关键实现**：`UserManager.get_by_natural_key()` 使用 `email__iexact`，
因此 `DEV@example.com` 可以登录 `dev@example.com` 的账号。
`ModelBackend.authenticate()` 正是通过它解析用户的。

**属性**：`user.name` → `display_name or username`，供 API 直接输出。

---

## 3. `todos.Workspace`

一个项目 / 一个版本 / 一个 vision。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | BigAutoField | PK | |
| `owner` | FK → User | CASCADE, indexed | **数据隔离的锚点** |
| `name` | CharField(120) | | |
| `description` | TextField | blank | |
| `visibility` | CharField(16) | default `private` | `private` / `shared`，V1 恒为 private |
| `is_archived` | BooleanField | default False | 列表默认不展示 |
| `sort_order` | Int | default 0 | 用户自定义排序 |
| `created_at` / `updated_at` | DateTime | auto | |
| `members` | M2M → User | through `WorkspaceMember` | **共享能力的载体** |

**索引**：`(owner, is_archived)`、`(visibility)`
**排序**：`sort_order ASC, created_at DESC`
**上限**：每用户 50 个（由 `MAX_WORKSPACES_PER_USER` 控制，在 `perform_create` 校验）

**为什么冗余 `visibility` 与 `members`**：共享工作区是产品的下一个明确目标。
现在把表结构摆好，V1.2 上线共享时**不需要任何数据库迁移**，
视图层的 `for_user()` 也已经同时支持 owner 与 member 两条路径。

---

## 4. `todos.WorkspaceMember`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `workspace` | FK → Workspace | CASCADE, `related_name="memberships"` | |
| `user` | FK → User | CASCADE, `related_name="workspace_memberships"` | |
| `role` | CharField(16) | default `member` | `owner`/`admin`/`member`/`viewer` |
| `invited_by` | FK → User | SET_NULL, null | 预留 |
| `created_at` | DateTime | auto | 对 API 输出为 `joined_at` |

**唯一约束**：`(workspace, user)`
**V1 行为**：创建 Workspace 时自动插入一条 `role=owner` 的记录。
`GET /workspaces/{id}/members/` 因此永远返回 1 行。

> 注意：`Workspace.members` 是到 `User` 的多对多，`WorkspaceMember.workspace` 的
> 反向名是 `memberships`，两者刻意区分：
> `workspace.members` → 用户集合（用于权限判断）；`workspace.memberships` → 成员关系行（用于展示 role/joined_at）。
> `through_fields=("workspace", "user")` 用于消除 `WorkspaceMember` 上指向 User 的两个外键
> （`user` 与 `invited_by`）带来的歧义。

---

## 5. `todos.TaskList`

工作区内部的阶段/主题分组：需求梳理 / 开发 / 联调 / 复盘。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `workspace` | FK → Workspace | CASCADE, `related_name="lists"` | |
| `name` | CharField(120) | | |
| `description` | TextField | blank | |
| `sort_order` | Int | default 0 | |
| `is_archived` | BooleanField | default False | |

**索引**：`(workspace, is_archived)`
**排序**：`sort_order ASC, created_at ASC`
**删除语义**：`on_delete=SET_NULL` **不在清单上**，而在任务侧 ——
删除清单时其下任务的 `task_list` 被置空，任务落入「未分组」，**不会丢数据**。

---

## 6. `todos.Tag`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `workspace` | FK → Workspace | CASCADE, `related_name="tags"` | 标签按工作区隔离 |
| `name` | CharField(40) | | |

**唯一约束**：`(workspace, name)` —— 不同工作区可以有同名标签
**排序**：`name ASC`
**删除**：仅解除与任务的关联（M2M），不删除任务

> 标签挂在 Workspace 而非 User 下，是为了共享工作区时标签天然共享。

---

## 7. `todos.Task`

核心实体。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `workspace` | FK → Workspace | CASCADE | 冗余存储，用于跨清单筛选与「收件箱」 |
| `task_list` | FK → TaskList | SET_NULL, null | 为空 = 未分组 / 收件箱 |
| `parent` | FK → self | CASCADE, null | 子任务；**只允许一层** |
| `created_by` | FK → User | SET_NULL, null | 审计用 |
| `title` | CharField(200) | 非空（去空格后） | |
| `description` | TextField | blank | |
| `status` | CharField(16) | default `todo` | `todo`/`doing`/`blocked`/`done` |
| `priority` | CharField(16) | default `medium` | `low`/`medium`/`high`/`urgent` |
| `task_type` | CharField(20) | default `other` | `dev`/`meeting`/`communication`/`design`/`research`/`other` |
| `due_date` | DateField | null | 只到天，不含时间 |
| `completed_at` | DateTime | null | 由 `save()` 自动维护 |
| `sort_order` | Int | default 0 | 同层内排序 |
| `is_archived` | BooleanField | default False | |
| `tags` | M2M → Tag | blank | |
| `created_at` / `updated_at` | DateTime | auto | |

**索引**：`(workspace, is_archived, status)`、`(workspace, task_list)`、
`(workspace, due_date)`、`(parent)`
**排序**：`sort_order ASC, created_at ASC`

### 7.1 业务规则（服务端强制）

| 规则 | 实现位置 |
| --- | --- |
| `title` 去空格后不能为空 | `TaskSerializer.validate_title` |
| `task_list` 必须与任务同工作区 | `TaskSerializer.validate` |
| `parent` 必须与任务同工作区 | `TaskSerializer.validate` |
| `parent.parent` 必须为空（禁止三层） | `TaskSerializer.validate` |
| 任务不能成为自己的父任务 | `TaskSerializer.validate` |
| 已有子任务的任务不能再成为别人的子任务 | `TaskSerializer.validate` |
| 标签必须属于同工作区 | `TaskSerializer.validate` |
| `status=done` → 自动写 `completed_at` | `Task.save()` |
| 状态离开 `done` → 清空 `completed_at` | `Task.save()` |
| 新建任务 `sort_order` 自动取同层最大值 +1 | `TaskSerializer._next_sort_order` |
| `is_overdue` = `due_date < today AND status != done` | `Task.is_overdue`（计算属性，不入库） |

> `completed_at` 放在 `save()` 而非序列化器，是为了让 admin、shell 脚本、
> 未来的定时任务走同一套逻辑，避免出现「只有 API 路径正确」的隐性 bug。

### 7.2 聚合字段（API 输出，非数据库列）

| 输出字段 | 来源 | 说明 |
| --- | --- | --- |
| `subtask_stats.total` / `.done` | `Count("subtasks", distinct=True)` | 列表页一次查询取回，避免 N+1 |
| `workspace_name` / `task_list_name` | `select_related` | 免去前端二次请求 |
| `is_overdue` | `Task.is_overdue` | 服务端计算，保证时区口径统一 |

### 7.3 冗余 `Task.workspace` 的理由

`workspace` 可以由 `task_list.workspace` 推导，但那样：
① 未分组任务无法归属工作区；② 跨清单筛选要额外 JOIN。
代价是写入时需校验一致性（已在序列化器验证），收益是查询路径显著更短。

---

## 8. 数据隔离的实现

所有业务查询都收敛到一个入口：

```python
class WorkspaceQuerySet(models.QuerySet):
    def for_user(self, user):
        return self.filter(Q(owner=user) | Q(members=user)).distinct()
```

- `WorkspaceViewSet.get_queryset()` → `Workspace.objects.for_user(user)`
- `TaskListViewSet.get_queryset()` → `filter(workspace__in=Workspace.objects.for_user(user))`
- `TagViewSet.get_queryset()` → 同上
- `TaskViewSet.get_queryset()` → `Task.objects.for_user(user)`

详情路由通过 `ScopedDetailMixin` 直接从上述查询集取对象，
**绕过列表过滤器**（列表过滤器要求 `workspace` 参数），但**不绕过用户作用域**。
他人资源因此返回 404 而非 403，避免泄漏资源是否存在。

---

## 9. 迁移与演进

| 变更 | 是否需要迁移 | 说明 |
| --- | --- | --- |
| 开放共享工作区 | ❌ 不需要 | 表与查询已就绪，只需加邀请接口 |
| 看板拖拽排序 | ❌ 不需要 | `sort_order` 与 `reorder` 接口已存在 |
| 任务支持多层子任务 | ⚠️ 不需要改表 | 只需放宽序列化器校验；渲染需配套改造 |
| 任务增加预估工时 | ✅ 需要 | 新增列，可空，向后兼容 |
| 离线写入 | ✅ 需要 | 增加 `client_id` 唯一列用于幂等 |

生成与校验：

```bash
make makemigrations          # 生成
make migrate                 # 应用
docker run --rm --entrypoint python -v "$PWD/backend:/app" -w /app \
  -e DJANGO_SECRET_KEY=k todolist-backend:latest manage.py makemigrations --check --dry-run
```
