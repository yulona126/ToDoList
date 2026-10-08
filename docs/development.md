# ToDoList · 本地开发指南

---

## 1. 两种开发模式

| 模式 | 适用 | 说明 |
| --- | --- | --- |
| **A. 全容器** | 只想跑起来看一眼 | `docker compose up -d --build`，改代码需重新 build |
| **B. 混合** | 日常开发（推荐） | 数据库跑容器，后端/前端跑本机，支持热更新 |

---

## 2. 模式 B：混合开发

### 2.1 只启动数据库

```bash
docker compose up -d db
```

### 2.2 后端（热更新）

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export DJANGO_DEBUG=true
export DJANGO_SECRET_KEY=dev-only-key
export POSTGRES_HOST=127.0.0.1
export POSTGRES_PORT=5433          # 注意是宿主映射端口，不是 5432
export POSTGRES_DB=todolist
export POSTGRES_USER=todolist
export POSTGRES_PASSWORD=todolist_dev_password

python manage.py migrate
python manage.py createsuperuser   # 可选，用于访问 /admin/
python manage.py runserver 0.0.0.0:8000
```

建议把上面这些 export 放进 `backend/.envrc`（direnv）或一个不提交的 `local.sh`。

> 注意：本机 Python 必须是 **3.12 / 3.13**。Django 5.2 LTS 官方支持到 3.13。
> 若本机是 3.14，请改用模式 A 或容器内开发。

### 2.3 前端（热更新）

```bash
cd frontend
npm install
npm run dev        # → http://localhost:5173
```

Vite 已配置把 `/api` 代理到 `http://localhost:8000`，
因此开发时前端与后端**同源**，无需处理 CORS 预检。

### 2.4 端口对照（混合模式）

```
前端 Vite   :5173  ──proxy /api──►  后端 :8000  ──►  容器 db :5433
```

---

## 3. ⚠️ 本机 npm 缓存问题

这台机器的 `~/.npm` 里存在 **root 所有的文件**，会导致 npm 报：

```
npm error code EPERM
npm error path /Users/<you>/.npm/_cacache/tmp/...
npm error Your cache folder contains root-owned files
```

三种处理方式，任选其一：

**① 项目内独立缓存（推荐，不改动系统）**

```bash
export npm_config_cache="$PWD/.npm-cache"     # 在 frontend/ 下执行
npm install
```

`.npm-cache/` 已加入 `.gitignore`。

**② 永久修复（需要 sudo）**

```bash
sudo chown -R $(id -u):$(id -g) ~/.npm
```

**③ Docker 构建不受影响** —— 容器内是干净的 npm 环境，
所以 `docker compose build frontend` 始终可用。

---

## 4. 目录速查

```
backend/
├── config/             settings / urls / wsgi / asgi
├── apps/common/        分页、错误信封、权限、mixin
├── apps/accounts/      用户、认证
└── apps/todos/         领域模型、序列化器、过滤器、视图集、测试

frontend/src/
├── lib/                axios 客户端、工具、常量
├── types/              与 docs/api.md 一一对应的 DTO
├── i18n/               i18next + 中英词条
├── stores/             AuthContext（会话）、UIContext（主题/语言/Toast）
├── hooks/              React Query 数据 hooks
├── components/         ui / layout / tasks / workspace / list / auth / pwa
└── pages/              路由页面
```

---

## 5. 测试与质量门禁

```bash
# --- 后端（需要 db 容器在跑） ---
cd backend
python manage.py test                      # 全量
python manage.py test apps.todos           # 单个 app
python manage.py test apps.todos.tests.test_api.TaskTests.test_toggle_endpoint

# 或在容器里跑（无需本机 Python 环境）
docker run --rm --network todolist_net -v "$PWD/backend:/app" -w /app \
  -e DJANGO_SECRET_KEY=test -e POSTGRES_HOST=db -e POSTGRES_DB=todolist \
  -e POSTGRES_USER=todolist -e POSTGRES_PASSWORD=todolist_dev_password \
  --entrypoint python todolist-backend:latest manage.py test

# --- 前端 ---
cd frontend
npm run typecheck     # tsc --noEmit，必须 0 错误
npm run build         # 必须成功且产出 dist/sw.js

# --- 端到端（全栈跑起来之后） ---
./scripts/e2e.sh
```

提交前请确保 `docs/project-plan.md` §5.2 的 G1–G7 七道门禁全绿。

---

## 6. 开发约定

### 6.1 后端

- **新增字段**：改 `models.py` → `make makemigrations` → 确认迁移文件 → `make migrate` → 同步更新 `docs/data-model.md`。
- **新增接口**：序列化器 → 视图集 → 路由 → **补测试** → 更新 `docs/api.md`。
  契约文档先行，避免前端照着过时字段写代码。
- **越权是默认假设**：任何新查询集必须经过 `Workspace.objects.for_user(user)` 或其下游过滤。
- **不要绕过 `Task.save()`**：`completed_at` 的一致性逻辑在里面。
  批量操作若使用 `queryset.update()`，必须显式写 `completed_at`。
- **类型注解**：公共函数与视图方法需带注解，便于以后接 mypy。

### 6.2 前端

- **不写 `any`**：用 `unknown` + 收窄。`tsc` 开启了 `strict`、`noUnusedLocals`、`noUnusedParameters`。
- **不硬编码颜色**：只用 `docs/design-system.md` 中的 CSS 变量（通过 Tailwind 工具类使用）。
- **不硬编码文案**：所有面向用户的字符串走 `t('...')`，中英都要补。
- **服务端状态一律走 React Query**：不要用 `useState` 缓存接口数据。
  queryKey 统一从 `src/hooks/queryKeys.ts` 取。
- **写操作要乐观更新并回滚**：参考 `useTasks.ts` 中 toggle / delete 的写法。
- **可交互元素必须有可访问名**：图标按钮加 `aria-label`。

### 6.3 提交信息

```
<type>(<scope>): <subject>

feat(todos): 支持任务批量归档
fix(auth): 修复邮箱大小写导致无法登录
docs(api): 补充 reorder 接口的越权说明
```

---

## 7. 常见开发任务

### 7.1 加一个新的任务字段（示例：预估工时 `estimate_hours`）

1. `backend/apps/todos/models.py`：加 `estimate_hours = models.PositiveIntegerField(null=True, blank=True)`
2. `make makemigrations && make migrate`
3. `backend/apps/todos/serializers.py`：把字段加进 `TaskSerializer.Meta.fields`
4. `backend/apps/todos/tests/test_api.py`：加断言
5. `frontend/src/types/index.ts`：`Task` 接口加 `estimate_hours: number | null`
6. `frontend/src/components/tasks/TaskFormModal.tsx` + `TaskItem.tsx`：渲染与编辑
7. `frontend/src/i18n/locales/*.ts`：补 `task.estimate` 文案
8. `docs/api.md` / `docs/data-model.md`：同步

### 7.2 调试认证问题

```bash
# 拿一个 token
curl -s -X POST localhost:8081/api/v1/auth/login/ \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"..."}' | python3 -m json.tool

# 用它调接口
curl -s localhost:8081/api/v1/workspaces/ \
  -H "Authorization: Bearer <access>" | python3 -m json.tool
```

### 7.3 看 Service Worker 是否生效

浏览器 DevTools → Application → Service Workers。
「离线可读」的验证方式：切到 Network 面板的 Offline，刷新页面，
已访问过的数据应仍然可见（来自 `api-cache`），写操作应当失败并弹 Toast。

---

## 8. 常见问题

| 问题 | 原因 | 处理 |
| --- | --- | --- |
| `connection to server at "127.0.0.1", port 5433 failed` | db 容器没起 | `docker compose up -d db` |
| 后端启动即 `ImproperlyConfigured` | `DJANGO_DEBUG=false` 且没给 `DJANGO_SECRET_KEY` | 设 `DJANGO_SECRET_KEY` 或把 `DJANGO_DEBUG` 设为 `true` |
| `tsc` 报找不到 `vite-plugin-pwa/client` 类型 | `npm install` 未完成 | 重新 `npm install`（带 `npm_config_cache`） |
| Vite 代理 502 | 后端没在 8000 端口 | 启动 Django dev server |
| 前端改了 `.ts` 但页面没变 | 类型错误导致 HMR 中断 | 看终端里的 tsc 报错 |
| `makemigrations` 想连数据库 | 正常行为（会做一致性检查） | 可忽略那行 RuntimeWarning |
