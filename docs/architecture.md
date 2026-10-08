# ToDoList · 系统架构设计

> 版本：v1.0 ｜ 状态：已定稿（V1 实现基线）
> 适用：开发人员个人/小团队的「项目上下文外脑」

---

## 1. 背景与问题陈述

在 AI 辅助编码（Vibe Coding）成为主流的当下，开发者的工作重心从「写代码」前移到「梳理上下文」：

- 一个版本/项目在启动期需要沉淀大量**决策、约束、待办、会议结论**；
- 与 AI 协作时，注意力被局部实现牵走，**跨会话的长期记忆会丢失**；
- 常见的 Todo 工具（清单型）缺少「项目/工作区」这一层语义，无法回答"这个版本我还欠着哪些事"。

**本工具要解决的核心问题**：为一个项目（或一个 vision）提供一个**结构化的、随时可打开、可离线查看**的待办中枢。

## 2. 目标与非目标

### 2.1 V1 目标

| 编号 | 目标 | 验收标准 |
| --- | --- | --- |
| G1 | 用户体系 | 邮箱/用户名 + 密码注册登录，JWT 鉴权，数据按用户隔离 |
| G2 | 工作区管理 | 用户可创建多个 Workspace（一个项目/vision 一个） |
| G3 | 清单分组 | Workspace 下可按阶段/主题建立 List（需求/开发/联调…） |
| G4 | 任务管理 | 任务 CRUD，含状态、优先级、类型、截止日、标签、子任务 |
| G5 | 中英双语 | 全站文案可在 中文 / English 之间切换并持久化 |
| G6 | PWA | 可安装到桌面，App Shell 预缓存，离线可打开并读取最近数据 |
| G7 | 一键部署 | `docker compose up -d --build` 单命令拉起完整栈 |
| G8 | 可演进 | 为「共享工作区」预埋数据模型与权限位，无需破坏性迁移 |

### 2.2 明确不在 V1 范围（Non-Goals）

- ❌ 工作区邀请/共享的 **UI 与流程**（仅落库表结构 + 只读接口，见 §6.4）
- ❌ 离线**写入**与冲突合并（离线仅保证"可读"，写操作断网即失败并提示）
- ❌ 看板拖拽、甘特图、日历视图
- ❌ 邮件通知、WebSocket 实时同步、移动端原生封装
- ❌ 第三方 OAuth 登录（保留扩展点）
- ❌ 全文检索（V1 仅按 workspace/状态/优先级/类型/标签/关键词做过滤）

以上进入 `docs/roadmap.md`。

---

## 3. 总体架构

### 3.1 架构风格

采用 **前后端分离 + 单仓库（Monorepo）** 结构。前端构建为纯静态产物由 Nginx 托管，
后端提供无状态 REST API（JWT），数据落 PostgreSQL。

```
                             ┌──────────────────────────────┐
   浏览器 / PWA 安装          │        Nginx (frontend)       │
   ┌─────────────┐            │  ── 静态资源 (SPA, immutable)  │
   │  React SPA  │◄──────────►│  ── SPA fallback → index.html │
   │  + Service  │            │  ── /api,/admin,/static → proxy│
   │    Worker   │            └───────────────┬──────────────┘
   └──────┬──────┘                            │ http (docker network)
          │ fetch /api/v1/*                   ▼
          │                        ┌──────────────────────────┐
          │                        │  Django + DRF (gunicorn)  │
          │                        │  ── SimpleJWT 鉴权        │
          │                        │  ── ViewSet / Serializer │
          │                        │  ── drf-spectacular 文档  │
          │                        └────────────┬─────────────┘
          │                                     │ psycopg3
          │                                     ▼
          │                        ┌──────────────────────────┐
          └───同源，无 CORS───────►│   PostgreSQL 17 (volume) │
                                   └──────────────────────────┘
```

**关键决策：生产环境前后端**同源**（Nginx 反向代理 `/api`）。**
理由：① 免除生产环境 CORS 与 Cookie 策略复杂度；② Service Worker 缓存策略更简单；
③ 只需暴露一个端口。开发环境则由 Vite dev server 代理 `/api` → `localhost:8000`，同样保持同源心智。

### 3.2 分层职责

| 层 | 组件 | 职责 | 禁止事项 |
| --- | --- | --- | --- |
| 表现层 | React + Tailwind | 渲染、路由、i18n、表单校验、乐观更新 | 不拼 SQL、不存业务规则 |
| 应用层 | DRF ViewSet / Serializer | 鉴权、参数校验、权限判定、DTO 组装 | 不写复杂 JOIN 逻辑 |
| 领域层 | Django Model / Manager | 数据约束、owner 作用域、软删除与排序 | 不感知 HTTP |
| 基础设施 | Postgres / Nginx / Docker | 持久化、静态托管、编排 | — |

---

## 4. 技术选型与理由

### 4.1 后端

| 技术 | 版本 | 选型理由 |
| --- | --- | --- |
| Python | 3.12 (slim) | Django 5.2 LTS 官方支持区间内，生态最稳 |
| Django | 5.2.x **LTS** | LTS 支持至 2028，避免非 LTS 的频繁升级成本 |
| Django REST Framework | 3.18.x | ViewSet/Serializer/权限体系成熟，减少样板代码 |
| djangorestframework-simplejwt | 5.5.x | 无状态鉴权，天然适配 PWA 与多端 |
| psycopg | 3.3.x (`[binary]`) | 官方推荐的 PG 驱动，无需本地编译 |
| drf-spectacular | 0.30.x | 自动生成 OpenAPI 3，前后端契约可校验 |
| django-cors-headers | 4.9.x | 仅开发环境放开 5173，生产同源无需 CORS |
| django-filter | 26.x | 声明式筛选（状态/优先级/类型/标签） |
| gunicorn | 26.x | 生产 WSGI server |
| whitenoise | 6.12.x | 后端自带 admin 静态文件托管，省一个 volume |

### 4.2 前端

| 技术 | 版本 | 选型理由 |
| --- | --- | --- |
| React | 19.3 | 主流、生态最全 |
| TypeScript | 5.9 (strict) | 契约类型安全，`strict: true` + 无 `any` |
| Vite | 8.3 | 构建快，PWA 插件生态成熟 |
| Tailwind CSS | 4.3 (`@tailwindcss/vite`) | v4 零配置，设计令牌用 CSS 变量，天然适合黑白极简 |
| tailwind-merge | 3.7 | `cn()` 的冲突消解层，保证「基类 + 调用方覆盖」可靠生效 |
| TanStack Query | 5.104 | 服务端状态缓存/失效/乐观更新，省掉手写 store |
| React Router | 7.18 | 客户端路由 |
| axios | 1.20 | 拦截器实现静默刷新 token |
| i18next + react-i18next | 26 / 17 | 中英双语 + 命名空间 |
| vite-plugin-pwa | 2.0 (Workbox) | Manifest + Service Worker 生成 |
| dayjs | 1.11 | 轻量日期处理 |

### 4.3 为什么不引入的东西

- **Redux / Zustand**：服务端状态全部交给 TanStack Query，客户端状态仅"当前工作区 + 主题 + 语言"，
  用 Context 足够，避免过度设计。
- **Ant Design / MUI**：黑白极简需要精细控制视觉，组件库会带来覆盖成本；V1 自建 ~12 个原子组件。
- **Celery / Redis**：V1 没有异步任务，引入即增加运维面。

---

## 5. 数据模型

### 5.1 ER 关系

```
User ──1:N──► Workspace ──1:N──► TaskList ──1:N──► Task ──N:M──► Tag
  │             │  │                                  │
  │             │  └──1:N──► WorkspaceMember           └──self 1:N──► SubTask
  │             └──1:N──► Tag                                 (parent FK)
  └──1:N──► Task (created_by)
```

约束要点：

- `Workspace.owner` 是数据隔离的**唯一锚点**；所有下游查询都必须收敛到 owner 可见的 workspace 集合。
- `Task.workspace` 冗余存储（虽可由 list 推导），用于**加速跨清单筛选**并保证任务可归属"收件箱"（list 为空）。
- `Task.parent` 自引用实现子任务，**只允许一层**（在 serializer 校验），避免无限递归与排序复杂度。
- 标签挂在 Workspace 维度而非用户维度，为后续共享工作区做准备。

### 5.2 枚举设计

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `Task.status` | `todo` / `doing` / `blocked` / `done` | blocked 对应"等 AI/等联调/等反馈" |
| `Task.priority` | `low` / `medium` / `high` / `urgent` | 默认 medium |
| `Task.task_type` | `dev` / `meeting` / `communication` / `design` / `research` / `other` | 对应需求中"交流/开会/开发" |
| `Workspace.visibility` | `private` / `shared` | V1 恒为 private，共享功能开关位 |
| `WorkspaceMember.role` | `owner` / `admin` / `member` / `viewer` | V1 仅写入 owner 一条 |

详见 `docs/data-model.md`。

---

## 6. 鉴权与权限模型

### 6.1 认证流程

```
注册  POST /api/v1/auth/register/ ──► 创建 User ──► 返回 access + refresh + user
登录  POST /api/v1/auth/login/    ──► 校验密码   ──► 返回 access + refresh + user
调用  Authorization: Bearer <access>          （有效期 60min）
刷新  POST /api/v1/auth/refresh/  ──► 用 refresh 换新 access（有效期 14d，轮转+黑名单）
注销  POST /api/v1/auth/logout/   ──► 将 refresh 加入黑名单
```

前端 token 存放策略（V1 权衡）：

- `access` 存内存（模块级变量），避免 XSS 直接读取；
- `refresh` 存 `localStorage`，刷新页面可恢复会话；
- axios 响应拦截器遇 401 自动用 refresh 换新 access 并**重放原请求**；刷新失败则清空并跳登录。

> 风险与后续：`refresh` 落 localStorage 仍有 XSS 面。演进方案见 roadmap（refresh 改 HttpOnly Cookie + CSRF）。

### 6.2 授权（对象级）

所有业务查询集通过一个统一入口收敛：

```python
Workspace.objects.filter(Q(owner=user) | Q(members__user=user)).distinct()
```

V1 中 `members` 永远只含 owner 自己，因此等价于 `owner=user`；但查询写法已按共享语义写就，
**开启共享时无需改任何视图代码**。

### 6.3 越权防护

- 所有 ViewSet 一律 `permission_classes = [IsAuthenticated]`；
- 列表接口强制按上述可见集合过滤；
- 详情接口通过 `get_queryset()` 过滤 → 他人资源返回 **404**（而非 403，避免资源存在性泄漏）；
- 写入时校验 `task.workspace` 与目标 `task_list.workspace` 一致，防止跨工作区挂载。

---

## 7. API 设计原则

- 统一前缀 `/api/v1/`；资源用复数名词；动作用子路径（`/tasks/reorder/`）。
- 分页：`?page=&page_size=`，响应 `{count, next, previous, results}`。
- 错误体统一为 `{"detail": "...", "errors": {field: [msg]}}`。
- 时间统一 ISO 8601 UTC（`2026-01-01T09:00:00Z`），日期字段 `YYYY-MM-DD`。
- 排序：`?ordering=-priority,due_date`。
- 完整契约见 `docs/api.md`，运行时 OpenAPI 见 `/api/docs/`。

---

## 8. 前端架构

### 8.1 目录结构

```
frontend/src
├── main.tsx               入口：Provider 组装（Query/Theme/I18n/Auth/Router）
├── App.tsx                路由表
├── index.css              设计令牌（CSS 变量）+ Tailwind 引入
├── components/
│   ├── ui/                原子组件：Button/Input/Select/Modal/Checkbox/Badge/…
│   ├── layout/            AppShell / Sidebar / Topbar
│   ├── tasks/             TaskItem / TaskFormModal / TaskFilters / SubTaskList
│   ├── workspace/         WorkspaceSwitcher / WorkspaceFormModal
│   ├── list/              ListFormModal
│   ├── auth/              ProtectedRoute
│   └── pwa/               InstallPrompt / UpdatePrompt
├── pages/                 Login / Register / Workspace / Settings / NotFound
├── hooks/                 与 React Query 绑定的数据 hooks
├── lib/                   api(axios+拦截器) / queryClient / utils
├── i18n/                  i18next 初始化 + locales/{zh-CN,en-US}.ts
├── stores/                AuthContext / UIContext（主题·语言·Toast）
└── types/                 API DTO 类型定义（与 docs/api.md 一一对应）
```

### 8.2 状态管理边界

| 状态类型 | 方案 | 例子 |
| --- | --- | --- |
| 服务端状态 | TanStack Query | 工作区列表、任务列表、标签 |
| 会话状态 | AuthContext | access/refresh token、当前用户 |
| 设备偏好 | UIContext + localStorage | 主题、语言、侧栏折叠 |
| 瞬时 UI | 组件本地 state | Modal 开关、表单草稿 |

**不引入全局 store**：任何一处的业务数据都应可通过 queryKey 溯源。

> **样式合并约定**：`lib/utils.ts` 的 `cn()` 必须为 `twMerge(clsx(...))`。
> 组件普遍采用「基类 + 调用方覆盖」（如 `Select` 的 `containerClassName`），
> 而纯 `clsx` 会同时输出冲突的 `w-full` 与 `w-[110px]`，让胜负取决于样式表顺序 ——
> 这正是筛选栏曾退化成 7 行的根因（见 project-plan §10.3 D9）。

### 8.3 路由

| 路径 | 页面 | 鉴权 |
| --- | --- | --- |
| `/login` `/register` | 登录/注册 | 公开（已登录则跳首页） |
| `/` | 重定向到最近工作区，无则空态引导 | 需登录 |
| `/w/:workspaceId` | 工作区任务台（按清单分组 + 筛选） | 需登录 |
| `/w/:workspaceId/l/:listId` | 聚焦某清单 | 需登录 |
| `/settings` | 账户、主题、语言、密码 | 需登录 |
| `*` | 404 | — |

### 8.4 PWA 策略

| 项 | 策略 |
| --- | --- |
| Manifest | 名称、主题色 `#0a0a0a`、`display: standalone`、192/512 + maskable 图标 |
| 预缓存 | App Shell（html/js/css/字体/图标），`navigateFallback: index.html` |
| API GET | `NetworkFirst`，3s 超时回退缓存，24h 过期 → **离线可读** |
| API 写 | `NetworkOnly`，断网直接失败并弹 Toast（不做离线队列） |
| 更新 | `registerType: 'autoUpdate'` + 顶部 UpdatePrompt 提示刷新 |
| 排除 | `/admin`、`/api/docs`、`/api/schema` 不缓存 |

---

## 9. 设计系统（黑白极简）

- **色彩**：无彩色体系。主色 `#0a0a0a`（近黑）/ 背景 `#ffffff`；暗色模式反相。
  仅用 3 档灰阶表达层级（`--fg` / `--muted` / `--border`），状态色（优先级/状态）
  **不引入彩色**，改用「填充度 + 图标 + 文字」表达，例如：
  - 优先级 `urgent` = 实心黑点，`high` = 半实心，`low` = 空心；
  - 状态 `done` = 删除线 + 灰化，`blocked` = 左侧粗黑边 + `!` 前缀。
- **字体**：系统字体栈，正文 14px，标题 16–20px，行高 1.5。
- **间距**：4px 基准栅格（Tailwind 默认刻度），卡片内边距 12/16。
- **圆角**：`8px`（控件）、`12px`（卡片）。
- **动效**：仅 150ms `ease-out` 的透明度/位移，尊重 `prefers-reduced-motion`。
- **可访问性**：所有可交互元素有 `:focus-visible` 外环；对比度 ≥ 4.5:1；图标按钮带 `aria-label`。

详规见 `docs/design-system.md`。

---

## 10. 部署架构

### 10.1 容器拓扑

| 服务 | 镜像 | 端口 | 说明 |
| --- | --- | --- | --- |
| `db` | `postgres:17-alpine` | 内网 5432，宿主 `5433` | 命名 volume `pgdata` 持久化 |
| `backend` | 自建 `python:3.12-slim` | 内网 8000，宿主 `8001` | 入口脚本：等 DB → migrate → collectstatic → gunicorn |
| `frontend` | 多阶段：`node:22-alpine` 构建 → `nginx:alpine` | 宿主 `8081` | 静态托管 + 反向代理 |

> 端口说明：宿主 8080 已被本机 Docker Desktop 占用，故前端选用 8081；PG 用 5433 避开本机 Homebrew postgres。

### 10.2 启动顺序与健康检查

```
db(healthcheck: pg_isready) ──healthy──► backend(healthcheck: /api/v1/health/)
                                              │
                                              └──► frontend(depends_on backend)
```

`backend` 入口脚本内置 **最多 30 次、每次 2s** 的 DB 等待重试，即使 compose 版本不支持
`condition: service_healthy` 也能自愈启动。

### 10.3 配置与密钥

- 全部通过环境变量注入，`.env.example` 为唯一契约文档；
- `DJANGO_SECRET_KEY` 无默认值时必须显式提供（默认值仅供本地体验，启动日志会告警）；
- `DJANGO_DEBUG=false` 为生产默认，开启 HSTS/SSL 重定向开关交给 `DJANGO_SECURE_SSL=1`。

---

## 11. 可观测性与运维

- **日志**：gunicorn access log + Django console（JSON 可选），统一输出到 stdout 由 `docker logs` 收集。
- **健康检查**：`GET /api/v1/health/` 返回 `{status, db, version}`，DB 不通返回 503。
- **备份**：`scripts/backup.sh` 封装 `pg_dump`；`scripts/restore.sh` 还原。
- **迁移**：容器启动自动 `migrate`（单人/小团队场景可接受；多副本部署时应拆为独立 job）。

## 12. 安全基线

| 项 | 措施 |
| --- | --- |
| 密码 | Django PBKDF2 哈希 + 最小长度 8 + Django 内置强度校验 |
| 传输 | 生产建议置于 TLS 终止之后，`DJANGO_SECURE_SSL=1` 打开 HSTS |
| 暴力破解 | simplejwt 无内置限流 → roadmap 引入 `django-axes` / Nginx `limit_req` |
| CSRF | JWT 走 Header，非 Cookie，天然免疫；Django admin 走 Cookie + CSRF 正常 |
| XSS | React 默认转义；禁用 `dangerouslySetInnerHTML`；CSP 头在 Nginx 中下发 |
| 越权 | 见 §6.3 |

## 13. 演进路线（摘要）

| 阶段 | 主题 | 关键改动 |
| --- | --- | --- |
| V1.1 | 共享工作区 | 开放 `WorkspaceMember` 邀请接口与 UI，无需迁移 |
| V1.2 | 看板与拖拽 | 新增 `sort_order` 批量重排接口（已预留字段） |
| V1.3 | 离线写入 | IndexedDB 写队列 + 幂等键（`client_id`）解决冲突 |
| V1.4 | 通知与搜索 | 引入 `pg_trgm` 全文检索、邮件/Web Push |
| V2.0 | AI 协同 | 任务自动拆解、会议纪要 → 任务、每日上下文摘要 |

完整路线图见 `docs/roadmap.md`。
