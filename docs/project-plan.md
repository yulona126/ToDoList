# ToDoList · 详细项目计划书

> 版本 v1.0 ｜ 目标：完成一个可自托管的、面向开发者的项目级 ToDoList PWA
> 关联文档：[架构设计](architecture.md) · [数据模型](data-model.md) · [API 契约](api.md) · [设计系统](design-system.md)

---

## 1. 项目概述

### 1.1 一句话定义

给开发者的「项目上下文外脑」：以一个 Workspace 对应一个项目/版本，
把梳理期产生的需求、开发、会议、沟通类事项沉淀成结构化待办，支持离线查看与一键自托管。

### 1.2 成功判据（Definition of Success）

| # | 判据 | 量化指标 |
| --- | --- | --- |
| S1 | 单命令可部署 | 全新机器上 `cp .env.example .env && docker compose up -d --build` 后 3 分钟内可访问 |
| S2 | 数据隔离可靠 | 跨用户访问任意资源返回 404；有自动化测试覆盖 |
| S3 | 核心流程闭环 | 注册 → 建工作区 → 建清单 → 建任务 → 改状态/筛选 全流程可用 |
| S4 | 可安装的 PWA | Lighthouse PWA 项通过，可添加到桌面，离线可打开 |
| S5 | 后端可回归 | 自动化测试覆盖所有 API 契约分支，全绿 |
| S6 | 双语可用 | 中/英切换后无残留硬编码文案 |
| S7 | 可演进 | 开启共享工作区不需改数据库 schema、不需改视图查询 |

### 1.3 范围边界

- **做**：Workspace / List / Task(含子任务) / Tag / 用户体系 / 双语 / PWA 可安装 + 离线可读 / Docker 一键部署
- **不做**（V1 明确排除）：共享 UI、离线写入、看板拖拽、通知、全文检索、OAuth

---

## 2. 里程碑计划

| 里程碑 | 名称 | 交付物 | 出口准则 |
| --- | --- | --- | --- |
| **M0** | 需求与架构定稿 | architecture.md / api.md / design-system.md | 契约冻结：字段名、枚举、错误体、端口均已确定 |
| **M1** | 工程骨架 | 目录结构、env 契约、compose 骨架 | `docker compose config` 通过 |
| **M2** | 后端可用 | Django 项目、模型、迁移、DRF 接口、JWT | 所有接口可被 `curl` 打通 |
| **M3** | 后端可信 | 测试套件、admin、OpenAPI 文档、健康检查 | 测试全绿；`makemigrations --check` 无变更 |
| **M4** | 前端可用 | SPA 全部页面与组件、i18n、PWA | `tsc --noEmit` 零错误；`vite build` 成功 |
| **M5** | 集成可部署 | Dockerfile ×2、Nginx、compose 全栈 | 一条命令起全栈，端到端脚本通过 |
| **M6** | 交付 | README、部署/开发文档、备份脚本、路线图 | 新用户按 README 可独立跑起来 |

---

## 3. 工作分解结构（WBS）

### 3.1 后端（`backend/`）

| 编号 | 任务 | 产出 | 状态 |
| --- | --- | --- | --- |
| B-01 | 项目配置与 12-factor 设置 | `config/settings.py` | ✅ |
| B-02 | 自定义用户模型（email 登录） | `apps/accounts/models.py` | ✅ |
| B-03 | 注册/登录/刷新/注销/改密接口 | `apps/accounts/{serializers,views,urls}.py` | ✅ |
| B-04 | 领域模型 Workspace/List/Task/Tag/Member | `apps/todos/models.py` | ✅ |
| B-05 | 用户作用域查询集 `for_user()` | `WorkspaceQuerySet` / `TaskQuerySet` | ✅ |
| B-06 | 统计注解（stats） | `with_stats()` + 序列化器 | ✅ |
| B-07 | 过滤/排序（含优先级语义排序） | `apps/todos/filters.py` | ✅ |
| B-08 | CRUD 视图集 + toggle/bulk/reorder | `apps/todos/views.py` | ✅ |
| B-09 | 统一错误信封 | `apps/common/exceptions.py` | ✅ |
| B-10 | 健康检查 | `apps/common/views.py` | ✅ |
| B-11 | 迁移文件 | `*/migrations/0001_initial.py` | ✅ |
| B-12 | Django admin | `*/admin.py` | ✅ |
| B-13 | OpenAPI 文档 | drf-spectacular → `/api/docs/` | ✅ |
| B-14 | 自动化测试 | `apps/*/tests/` | ✅ 75 通过 |
| B-15 | 容器入口脚本（等待 DB→迁移→静态→启动） | `entrypoint.sh` | ✅ |

### 3.2 前端（`frontend/`）

| 编号 | 任务 | 产出 | 状态 |
| --- | --- | --- | --- |
| F-01 | Vite + React + TS 严格模式骨架 | `vite.config.ts` / `tsconfig*.json` | ✅ |
| F-02 | 设计令牌与 Tailwind v4 接入 | `src/index.css` | ✅ |
| F-03 | 领域类型与枚举镜像 | `src/types/`、`src/lib/constants.ts` | ✅ |
| F-04 | axios 客户端 + 静默刷新（含并发去重） | `src/lib/api.ts` | ✅ |
| F-05 | i18n 中英双语 | `src/i18n/` | ✅ |
| F-06 | 会话上下文 | `src/stores/AuthContext.tsx` | ✅ |
| F-07 | UI/主题/Toast 上下文 | `src/stores/UIContext.tsx` | ✅ |
| F-08 | 12+ 原子组件 | `src/components/ui/` | ✅ |
| F-09 | 布局骨架 | `src/components/layout/` | ✅ |
| F-10 | 任务组件（行/表单/筛选/子任务） | `src/components/tasks/` | ✅ |
| F-11 | 页面（登录/注册/工作区/设置/404） | `src/pages/` | ✅ |
| F-12 | React Query 数据 hooks（乐观更新） | `src/hooks/` | ✅ |
| F-13 | PWA：Manifest / SW / 图标 / 安装与更新提示 | `vite.config.ts`、`public/` | ✅ |
| F-14 | 键盘快捷键 | 全局 hook | ✅ |
| F-15 | 构建验证 | `tsc --noEmit` + `vite build` | ✅ 零错误 |

### 3.3 基础设施与交付

| 编号 | 任务 | 产出 | 状态 |
| --- | --- | --- | --- |
| I-01 | 后端镜像（多阶段、非 root、健康检查） | `backend/Dockerfile` | ✅ |
| I-02 | 前端镜像（node 构建 → nginx 托管） | `frontend/Dockerfile` | ✅ |
| I-03 | Nginx：SPA fallback + 反向代理 + 缓存策略 | `frontend/nginx.conf` | ✅ |
| I-04 | Compose 编排（依赖健康、卷、端口） | `docker-compose.yml` | ✅ |
| I-05 | 环境变量契约 | `.env.example` | ✅ |
| I-06 | 常用操作入口 | `Makefile` | ✅ |
| I-07 | 备份/还原 | `scripts/{backup,restore}.sh` | ✅ |
| I-08 | 端到端验收脚本 | `scripts/e2e.sh` | ✅ |
| I-09 | 文档 | `README.md` + `docs/*` | ✅ |

---

## 4. 估算与实际投入

以「一名熟悉 Django + React 的工程师」为基准（人日，1 人日 = 6 小时有效产出）。

| 阶段 | 估算 | 说明 |
| --- | --- | --- |
| M0 架构与契约 | 1.5 | 契约不清会导致前后端返工，是最值得先花的时间 |
| M1 骨架 | 0.5 | — |
| M2 后端功能 | 3.0 | 模型 + 序列化器 + 视图集 + 认证 |
| M3 后端测试与打磨 | 2.0 | 75 个测试用例，含越权/边界 |
| M4 前端 | 6.0 | 组件库自建 + 双语 + PWA 是主要成本 |
| M5 容器化与联调 | 1.5 | Dockerfile、Nginx 缓存、健康检查编排 |
| M6 文档与交付 | 1.5 | README + 5 篇文档 |
| **合计** | **16.0** | 单人约 3 周 |

> 若改用组件库（Ant Design 等）可节省约 2 人日，但会牺牲黑白极简的视觉一致性。

---

## 5. 质量保证策略

### 5.1 分层验证

```
        ┌──────────────────────────────┐
   少   │  E2E：scripts/e2e.sh          │  真实 compose 环境跑完整流程
        ├──────────────────────────────┤
        │  构建门禁：tsc --noEmit       │  类型错误 = 构建失败
        │           vite build          │
        ├──────────────────────────────┤
        │  API 测试：Django TestCase    │  75 例，覆盖契约分支与越权
        ├──────────────────────────────┤
   多   │  静态检查：django check       │  模型/配置/迁移一致性
        └──────────────────────────────┘
```

### 5.2 必须通过的发布门禁

| 门禁 | 命令 | 通过标准 |
| --- | --- | --- |
| G1 | `docker compose config` | 配置合法 |
| G2 | `manage.py check` | 0 issue |
| G3 | `manage.py makemigrations --check --dry-run` | No changes detected |
| G4 | `manage.py test` | All tests pass |
| G5 | `npm run typecheck` | 0 error |
| G6 | `npm run build` | 产出 `dist/` 且含 `sw.js` |
| G7 | `scripts/e2e.sh` | 全流程断言通过 |

### 5.3 重点测试场景（已覆盖）

- **越权**：他人 workspaces/lists/tasks/tags 的读、改、删、批量操作一律 404 且数据不变
- **跨工作区污染**：把 A 工作区的清单/标签/父任务挂到 B 工作区的任务上 → 400
- **层级约束**：子任务不能有子任务；父任务不能变成自己子任务的子任务
- **状态一致性**：`status=done` 自动写 `completed_at`，回退时清空
- **过滤语义**：`tag=a,b` 为 AND；`priority` 排序为 urgent→low 而非字典序
- **级联行为**：删工作区级联删任务；删清单保留任务（落到未分组）
- **归档默认值**：不传参默认排除归档数据

---

## 6. 风险管理

| # | 风险 | 概率 | 影响 | 应对 | 结果 |
| --- | --- | --- | --- | --- | --- |
| R1 | 前后端契约漂移 | 中 | 高 | 先写 `api.md` 冻结字段名，两端口径一致 | 已规避 |
| R2 | 依赖版本互不兼容 | 中 | 中 | 全部锁定版本，构建期即暴露 | 已规避 |
| R3 | JWT 刷新并发风暴 | 中 | 中 | axios 层单飞刷新 + 请求重放 | 已实现 |
| R4 | PWA 缓存导致更新不生效 | 中 | 中 | `index.html`/`sw.js` 强制 no-cache | 已规避 |
| R5 | 宿主端口冲突 | 高 | 低 | 避开 8080/5432，改用 8081/5433 | 已规避 |
| R6 | 端口数据隔离被绕过 | 低 | 极高 | 统一 `for_user()` 收敛 + 越权测试 | 已覆盖 |
| R7 | 离线写入产生冲突 | — | — | 明确排除出 V1，改为离线只读 | 已降级 |
| R8 | 生产误用默认密钥 | 中 | 高 | 启动日志强告警 + `.env.example` 说明 | 已缓解 |
| R9 | 无登录限流被暴力破解 | 中 | 中 | 列入 V1.1；建议前置 Nginx `limit_req` | **未解决** |

> R9 是当前已知的最大安全缺口：`django-axes` 或 Nginx 限流已列入路线图第一项。

---

## 7. 验收清单

### 7.1 功能验收

- [x] 邮箱+用户名注册，密码强度校验，重复邮箱/用户名拒绝
- [x] 登录返回 JWT；access 过期后静默刷新，用户无感
- [x] 注销后 refresh token 进入黑名单，不可再用
- [x] 工作区 CRUD、归档、排序
- [x] 清单 CRUD、排序；删清单不丢任务
- [x] 任务 CRUD：状态/优先级/类型/截止日/标签/子任务
- [x] 任务一键完成（toggle）、批量完成/归档/删除
- [x] 标签按工作区隔离、同工作区内唯一
- [x] 按状态/优先级/类型/标签/清单/截止/关键词筛选
- [x] 侧栏工作区待办数徽标（实时统计）
- [x] 中英双语切换并持久化
- [x] 明暗主题切换并持久化
- [x] 键盘快捷键 `N` / `/` / `Esc` / `Cmd+Enter`

### 7.2 工程验收

- [x] `docker compose up -d --build` 一条命令启动全栈
- [x] 后端 75 项自动化测试全绿
- [x] 前端类型检查零错误、构建成功
- [x] 迁移无悬挂变更
- [x] 数据库卷持久化；备份/还原脚本可用
- [x] OpenAPI 文档可在 `/api/docs/` 访问
- [x] 健康检查端点供编排探活

### 7.3 PWA 验收

- [x] 提供 `manifest.webmanifest`（含 maskable 图标）
- [x] 生成 Service Worker 并预缓存 App Shell
- [x] 离线可打开并读取最近访问过的数据（NetworkFirst，3s 超时）
- [x] 写操作离线时明确失败并提示（不做静默丢弃）
- [x] 有新版本时提示刷新

---

## 8. 交付物清单

```
ToDoList/
├── README.md                 快速上手
├── docker-compose.yml        一键部署
├── .env.example              环境变量契约
├── Makefile                  常用操作
├── docs/
│   ├── architecture.md       架构设计（含决策与取舍）
│   ├── project-plan.md       本文件
│   ├── data-model.md         数据模型字段级说明
│   ├── api.md                API 契约
│   ├── design-system.md      UI 设计系统
│   ├── deployment.md         部署与运维手册
│   ├── development.md        本地开发指南
│   └── roadmap.md            演进路线
├── backend/                  Django 服务
├── frontend/                 React PWA
└── scripts/                  e2e / 备份 / 还原
```

---

## 9. 后续迭代计划（摘要，详见 roadmap.md）

| 版本 | 主题 | 关键动作 | 预估 |
| --- | --- | --- | --- |
| V1.1 | 安全加固 | 登录限流、refresh 转 HttpOnly Cookie、CSP 收紧 | 1.5 人日 |
| V1.2 | 共享工作区 | 开放成员邀请 API + UI（表结构已就绪） | 3 人日 |
| V1.3 | 看板视图 | 拖拽排序（`reorder` 接口已就绪） | 2 人日 |
| V1.4 | 离线写入 | IndexedDB 队列 + 幂等键 + 冲突策略 | 4 人日 |
| V1.5 | 检索与通知 | `pg_trgm` 全文搜索、Web Push | 4 人日 |
| V2.0 | AI 协同 | 会议纪要转任务、自动拆解、每日上下文摘要 | 8 人日 |

---

## 10. 实际执行记录（验收证据）

### 10.1 环境

```
macOS (darwin) · Docker 29.8.2 / Compose v5.5.1
Node v22.18.0 / npm 10.9.3
容器内：Python 3.12-slim · PostgreSQL 17-alpine · nginx 1.29-alpine
```

### 10.2 门禁执行结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| G1 | `docker compose config --quiet` | ✅ 通过 |
| G2 | `manage.py check` | ✅ `System check identified no issues (0 silenced)` |
| G3 | `manage.py makemigrations --check --dry-run` | ✅ `No changes detected` |
| G4 | `manage.py test` | ✅ **Ran 142 tests — OK** |
| G5 | `npm run typecheck` | ✅ 0 error |
| G6 | `npm run build` | ✅ 产出 `dist/`，含 `sw.js`、`manifest.webmanifest`，precache 15 项 |
| G7 | `./scripts/e2e.sh` | ✅ **passed 67 / failed 0** |

补充验证（超出基础门禁）：

- G4 额外在**已构建镜像内、无源码挂载**的条件下重跑 → 仍然 142 项全绿，
  证明交付物本身（而非开发目录）是可用的。
- 通过 Nginx 实测：`/assets/*` 为 `immutable, max-age=31536000`；
  `sw.js` / `index.html` 为 `no-cache, no-store`；`manifest.webmanifest`
  为 `application/manifest+json`；四个安全响应头在全部路径上恰好出现一次。
- SPA 深链 `/w/123`、`/settings` 均回退到 `index.html`（HTTP 200）。
- Django admin 静态资源经 Nginx `/static/` 别名直出（HTTP 200），未回源 gunicorn。
- 服务启动顺序实测：`db(healthy) → backend(healthy) → frontend(healthy)`。

### 10.3 验收过程中发现并修复的缺陷

这些是**在执行上述门禁时才暴露出来**的真实问题，记录以备回溯：

| # | 层 | 现象 | 根因 | 修复 |
| --- | --- | --- | --- | --- |
| D1 | 后端·安全 | 匿名请求 `GET /workspaces/` 返回 **200** 而非 401 | 视图集用了自定义权限类，**覆盖**掉了 DRF 默认的 `IsAuthenticated`，而自定义类只实现了 `has_object_permission` | 改为 `[IsAuthenticated, IsObjectOwnerOrMember]` |
| D2 | 后端·契约 | `GET /workspaces/` 返回了已归档工作区 | `django-filter` 对**缺失**的参数直接跳过过滤，文档写的默认值没生效 | 新增 `DefaultArchivedFilterMixin`，在 `__init__` 注入默认值 |
| D3 | 后端·功能 | 修改密码抛 `AttributeError: 'PasswordChangeSerializer' object has no attribute '_db'` | 在普通 `Serializer`（非 `ModelSerializer`）上调用了 `self._db` | 改为 `user.save(update_fields=["password"])` |
| D4 | 后端·功能 | `DEV@example.com` 无法登录已注册的 `dev@example.com` | `ModelBackend` 通过 `get_by_natural_key` 精确匹配 `USERNAME_FIELD` | 覆写 `UserManager.get_by_natural_key` 使用 `__iexact` |
| D5 | 后端·模型 | `makemigrations` 直接报 `fields.E335` | `WorkspaceMember` 上有两个指向 `User` 的外键，M2M through 无法自动判定；且反向名 `members` 与 M2M 字段名冲突 | 加 `through_fields=("workspace","user")`，反向名改为 `memberships` |
| D6 | 前端·功能 | 工作区主页永远显示"暂无任务" | 页面在未聚焦清单时传了 `task_list=null`，而该字面量在契约里表示"仅未分组" | 改为 `task_list: focusedListId ?? undefined`（`parent: null` 保持不变） |
| D7 | 运维·安全 | `/assets/*` 等路径**丢失**全部安全响应头 | Nginx 的 `add_header` 不跨层级合并：location 一旦自带 `add_header`，server 级的全部失效 | 抽出 `nginx-security-headers.conf`，在每个自带 `add_header` 的 location 内 `include` |
| D8 | 运维·整洁 | `/assets/*` 返回**两个** `Cache-Control` 头 | `expires` 与 `add_header Cache-Control` 同时生效 | 移除 `expires`，只保留显式 `add_header` |
| D9 | 前端·样式 | 筛选栏的 6 个下拉全部占满整宽，堆成 7 行 | `cn()` 只是 `clsx`，**不做冲突消解**：组件基类的 `w-full` 与调用方传入的 `w-[110px]` 同时输出，胜负由样式表顺序决定 | `cn()` 接入 `tailwind-merge`，并把筛选栏重构为「1 行常驻 + 仅筛选时 1 行 chip」 |
| D10 | 前端·会话 | 多标签页同时刷新时，其中一个标签页会被登出 | `ROTATE_REFRESH_TOKENS + BLACKLIST_AFTER_ROTATION`：两个标签页用同一 refresh 并发刷新，先到者使其失效，后到者 401 | 已知限制，列入 V1.1（见 roadmap）；当前失败表现为需重新登录，不丢数据 |

> D9 的教训：`clsx` 只负责拼接，**不负责解决冲突**。任何「组件基类 + 调用方覆盖」
> 的模式都必须配 `tailwind-merge`，否则覆盖会随机失效。
>
> D10 的发现过程：为视觉验证编写无头浏览器脚本时，
> 每次截图复用同一个 refresh token 都会 401 —— 这恰好复现了多标签页的真实竞争条件。

> D1 与 D7 说明：**"能跑通"不等于"符合契约"**。
> 若没有 G4 里那条 `anonymous access is rejected` 断言，这个越权缺口会被带到生产。

### 10.4 与计划的偏差

| 项 | 计划 | 实际 | 原因 |
| --- | --- | --- | --- |
| 前端语言 | 中英双语 | ✅ 一致 | 232 词条 × 2，通过 `TranslationSchema` 在编译期强制对齐 |
| PWA 离线 | 可读 + 写失败提示 | ✅ 一致 | 未做离线写队列（V1 非目标） |
| 图标产物 | 单份 | 曾产生双份，已收敛为 `public/icons/` 单份 | 生成脚本显式支持多目录；收敛后 precache 由 19 项降为 15 项 |
| 前端测试 | 未规划单测 | 仅 `tsc` + 构建 + 脚本化 i18n 审计 | 前端单测（Vitest）列入 V1.1；当前以 E2E 覆盖关键路径 |
| 前端包体 | 未设预算 | 单个 chunk 513 KB（gzip 160 KB），构建有告警 | 未做路由级 code splitting；列入 V1.1 |

### 10.5 计划外增量：AI 任务录入

§2.2 的非目标里原本把 AI 排到 V2.0。后续按用户要求提前落地了第一批，
独立成篇（[ai-assistant.md](ai-assistant.md)），因此不在 §3 的 WBS 中：

| 编号 | 任务 | 状态 |
| --- | --- | --- |
| A-01 | 本地规则解析器（前后端双实现，语法一致） | ✅ |
| A-02 | DeepSeek 客户端（超时、无重试、usage 解析） | ✅ |
| A-03 | API Key Fernet 加密存储 + 掩码接口 + SSRF 防护 | ✅ |
| A-04 | 提示词 token 经济（固定前缀、短键、只发名字） | ✅ |
| A-05 | 输出归一层（枚举/日期/清单映射/截断/告警） | ✅ |
| A-06 | `POST /ai/parse/`、`/ai/split/`、`/ai/usage/` | ✅ |
| A-07 | `POST /tasks/bulk-create/`（事务批量，非 AI 专用） | ✅ |
| A-08 | 每日 token 配额 + 用量审计 | ✅ |
| A-09 | 设置页 AI 区块、录入面板、草稿确认列表 | ✅ |
| A-10 | 测试（全部 mock，不打真实网络） | ✅ 新增 67 例 |

**仍未验证**：没有真实 DeepSeek API Key，因此**一次真实模型调用都没有跑过**。
上述全部测试与 E2E 走的都是 mock 或本地解析路径。
首次配置 Key 后请先点「测试连接」，并用一段真实文本确认提示词效果。

### 10.6 结论

G1–G7 七道门禁全部通过，§7.1 / §7.2 / §7.3 的验收清单逐项确认，
`docs/roadmap.md` 中标注"❌ 不需要迁移"的演进项（共享工作区、看板拖拽）
其数据结构与查询边界已在 V1 中就位。

