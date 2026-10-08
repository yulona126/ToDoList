# ToDoList · 部署与运维手册

目标：在一台干净的机器上，用一条命令跑起完整服务。

---

## 1. 前置条件

| 依赖 | 最低版本 | 说明 |
| --- | --- | --- |
| Docker Engine | 24+ | 需要 Compose V2 |
| Docker Compose | v2.20+ | 使用了 `depends_on.condition: service_healthy` |
| 磁盘 | 2 GB | 镜像约 400 MB，其余为数据库与构建缓存 |
| 内存 | 1 GB | 三个容器常驻约 300–400 MB |

不需要在本机安装 Python、Node 或 PostgreSQL —— 全部在容器内。

---

## 2. 快速部署

```bash
git clone <repo> ToDoList && cd ToDoList

cp .env.example .env
# 强烈建议先生成密钥：
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
# 把输出填进 .env 的 DJANGO_SECRET_KEY

docker compose up -d --build
```

首次启动约 2–4 分钟（拉基础镜像 + 装依赖 + 前端构建）。
`backend` 的入口脚本会自动等待数据库、执行迁移、收集静态文件，然后才启动 Gunicorn。

启动完成后：

| 入口 | 地址 |
| --- | --- |
| Web 应用 | http://localhost:8081 |
| REST API | http://localhost:8001/api/v1/ |
| OpenAPI 文档 | http://localhost:8001/api/docs/ |
| Django Admin | http://localhost:8081/admin/ |
| PostgreSQL | `localhost:5433`（用户/库见 `.env`） |

浏览器打开 8081 → 注册账号 → 开始用。**不需要**预先创建任何数据。

### 2.1 用 Makefile 更省事

```bash
make up        # 构建并启动
make ps        # 看状态
make logs S=backend
make down      # 停止（保留数据）
make down-v    # 停止并删除数据卷
```

---

## 3. 端口分配

| 服务 | 宿主端口 | 容器端口 | 备注 |
| --- | --- | --- | --- |
| frontend | `${WEB_PORT:-8081}` | 80 | 唯一需要对外暴露的端口 |
| backend | `${API_HOST_PORT:-8001}` | 8000 | 仅供调试；生产可移除该映射 |
| db | `${POSTGRES_HOST_PORT:-5433}` | 5432 | 仅绑定 `127.0.0.1` |

**为什么不是 8080 / 5432**：macOS 上 Docker Desktop 自身占用 8080，
而开发者本机常已跑着 PostgreSQL 的 5432。换端口是为了"零冲突启动"。

改端口只需在 `.env` 里改 `WEB_PORT` / `API_HOST_PORT` / `POSTGRES_HOST_PORT`。

---

## 4. 环境变量

完整清单见 [`.env.example`](../.env.example)。关键项：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | 空（用内置开发密钥） | **生产必须设置**。未设置时启动日志会打印醒目警告 |
| `DJANGO_DEBUG` | `false` | 保持 false |
| `DJANGO_ALLOWED_HOSTS` | `*` | 建议改为实际域名，如 `todo.example.com` |
| `DJANGO_TIME_ZONE` | `UTC` | 影响"逾期"的判定基准，建议设为本地区，如 `Asia/Shanghai` |
| `DJANGO_SECURE_SSL` | `false` | 置于 HTTPS 之后时设为 `true`，会打开 HSTS 与 Cookie Secure |
| `POSTGRES_PASSWORD` | `change-me-in-production` | **生产必须修改** |
| `MAX_WORKSPACES_PER_USER` | `50` | 单账号工作区上限 |
| `JWT_ACCESS_MINUTES` | `60` | access token 有效期 |
| `JWT_REFRESH_DAYS` | `14` | refresh token 有效期 |
| `DJANGO_SUPERUSER_EMAIL` / `_PASSWORD` | 空 | 两者都填时，首次启动自动创建超管 |

> `DJANGO_TIME_ZONE` 特别重要：`is_overdue` 与 `due=today/week` 都基于
> `timezone.localdate()` 计算，时区错了会让"今天到期"的判断偏移一天。

---

## 5. 容器拓扑与启动顺序

```
  db (postgres:17-alpine)
   │  healthcheck: pg_isready              interval 5s  / retries 12
   ▼  condition: service_healthy
  backend (python:3.12-slim + gunicorn)
   │  entrypoint: 等 DB → migrate → collectstatic → gunicorn
   │  healthcheck: GET /api/v1/health/     interval 15s / start_period 40s
   ▼  condition: service_healthy
  frontend (nginx:1.29-alpine)
      healthcheck: GET /healthz           interval 30s
```

三道保险：

1. `depends_on.condition` 控制编排层顺序；
2. `entrypoint.sh` 内含最多 30 次 × 2 秒的数据库重试，
   即使编排器忽略 condition 也能自愈；
3. 前端等后端**健康**才启动 —— 保证 Nginx 挂载静态目录时 `collectstatic` 已经跑完。

---

## 6. 数据持久化

| 卷 | 挂载点 | 内容 |
| --- | --- | --- |
| `todolist_pgdata` | `db:/var/lib/postgresql/data` | **全部业务数据** |
| `todolist_static` | `backend:/app/staticfiles`（读写）<br>`frontend:/var/www/static`（只读） | Django admin / DRF 静态资源 |
| `todolist_media` | `backend:/app/media`、`frontend:/var/www/media` | 预留（当前无上传功能） |

`docker compose down` 不会删除卷；`docker compose down -v` 会，请谨慎。

### 6.1 备份

```bash
./scripts/backup.sh
# → backups/todolist-20260211-093000.dump
```

可在服务运行中执行（`pg_dump` 使用一致性快照）。

建议加进 crontab：

```cron
0 3 * * * cd /srv/ToDoList && ./scripts/backup.sh >> /var/log/todolist-backup.log 2>&1
```

### 6.2 还原

```bash
./scripts/restore.sh backups/todolist-20260211-093000.dump
```

脚本会：停 backend → 重建 schema → `pg_restore` → 重启 backend。
**会覆盖目标库的全部现有数据**，因此要求手工输入 `yes` 确认。

---

## 7. 升级

```bash
git pull
docker compose up -d --build      # 重新构建并滚动重启
docker compose logs -f backend    # 观察迁移输出
```

后端每次启动都会执行 `migrate --noinput`，因此升级自动完成。
前端镜像重建后，已安装的 PWA 会在下次打开时通过 Service Worker 拿到新版本并提示刷新。

---

## 8. 反向代理与 HTTPS

生产建议在最外层再放一层 TLS 终止（Caddy / Traefik / Nginx / 云负载均衡），
把流量转发到本项目的 `frontend:80`。

以 Caddy 为例（自动申请证书）：

```caddyfile
todo.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8081
}
```

配套 `.env`：

```env
DJANGO_ALLOWED_HOSTS=todo.example.com
DJANGO_SECURE_SSL=true
CSRF_TRUSTED_ORIGINS=https://todo.example.com
```

`DJANGO_SECURE_SSL=true` 会启用：
`SECURE_SSL_REDIRECT`、`SESSION_COOKIE_SECURE`、`CSRF_COOKIE_SECURE`、
HSTS 一年（含子域与 preload）。

---

## 9. 运维常用命令

```bash
# 进 Django shell
make shell

# 进 psql
make dbshell

# 创建超管
make superuser

# 跑后端测试（需要 db 容器在运行）
make test-backend

# 看某个服务的日志
docker compose logs -f --tail=200 backend

# 看健康状态
curl -s localhost:8081/api/v1/health/ | python3 -m json.tool

# 资源占用
docker stats --no-stream
```

---

## 10. 故障排查

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `backend` 一直重启，日志停在 `waiting for PostgreSQL` | 数据库没起来 / 密码不匹配 | `docker compose logs db`；确认 `POSTGRES_PASSWORD` 一致 |
| 前端 502 Bad Gateway | backend 未通过健康检查 | `docker compose logs backend`；`curl localhost:8001/api/v1/health/` |
| `/admin/` 样式丢失 | `static_data` 卷未挂载或 `collectstatic` 失败 | `docker compose exec backend python manage.py collectstatic --noinput` |
| 页面能开但接口 401 | token 过期且 refresh 失败 | 退出重新登录；检查浏览器是否禁用了 localStorage |
| 改了 `.env` 不生效 | compose 只在创建容器时读取 | `docker compose up -d --force-recreate` |
| 前端构建 OOM | 机器内存 < 1 GB | 本地构建后只构建 nginx 镜像，或临时加 swap |
| PWA 不更新 | 浏览器缓存了旧 `sw.js` | 已在 Nginx 对 `sw.js`/`index.html` 强制 no-cache；仍不行则清除站点数据 |
| 端口被占用 | 8081/8001/5433 冲突 | 改 `.env` 中对应端口后 `up -d --force-recreate` |

---

## 11. 安全加固清单（上生产前逐项确认）

- [ ] `DJANGO_SECRET_KEY` 已设置为随机值（≥ 50 字符）
- [ ] `POSTGRES_PASSWORD` 已改为强密码
- [ ] `DJANGO_DEBUG=false`
- [ ] `DJANGO_ALLOWED_HOSTS` 收窄到实际域名
- [ ] 已置于 TLS 之后并 `DJANGO_SECURE_SSL=true`
- [ ] `API_HOST_PORT` 与 `POSTGRES_HOST_PORT` 的映射已从 compose 中移除（仅留 WEB）
- [ ] 在反向代理层对 `/api/v1/auth/login/`、`/api/v1/auth/register/` 做限流
- [ ] 已配置 `scripts/backup.sh` 定时任务并验证过还原流程
- [ ] 数据库卷所在磁盘有加密或访问控制

> ⚠️ **已知缺口**：应用层目前**没有登录失败限流**。
> 在补齐 `django-axes` 之前，请务必在反向代理层限制 `/api/v1/auth/*` 的请求频率，
> 例如 Nginx：
> ```nginx
> limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;
> location /api/v1/auth/login/ { limit_req zone=auth burst=5 nodelay; proxy_pass ...; }
> ```

---

## 12. 卸载

```bash
docker compose down -v          # 删除容器 + 网络 + 全部数据卷
docker rmi todolist-backend:latest todolist-frontend:latest
```
