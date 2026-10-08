# ToDoList · 端口与 Cloudflare Tunnel 部署

> 目标：把自托管的 ToDoList 挂到一个域名上（如 `todo.example.com`），
> 用 Cloudflare Tunnel 出网，**不开放任何入站端口**。

---

## 1. 端口一览

| 服务 | 宿主机 | 容器内 | 是否需要对公网开放 |
| --- | --- | --- | --- |
| **前端（Nginx，Web UI）** | **8081** | 80 | ❌ 不需要（Tunnel 走内网） |
| **后端 API（Gunicorn）** | **8001** | 8000 | ❌ 不需要 |
| **PostgreSQL** | **5433** | 5432 | ❌ **绝对不要** |
| MCP server（可选） | 无 | stdio | — |

默认值在 `.env` 里可改：

```env
WEB_PORT=8081            # 前端
API_HOST_PORT=8001       # 后端
POSTGRES_HOST_PORT=5433  # 数据库
```

**8081 而不是 8080**（macOS 上 Docker Desktop 自己占用 8080）；
**5433 而不是 5432**（避开本机已装的 PostgreSQL）。

访问地址：

| 用途 | 地址 |
| --- | --- |
| Web 应用 | http://localhost:8081 |
| REST API | http://localhost:8001/api/v1/ |
| API 文档 | http://localhost:8001/api/docs/ |
| Django Admin | http://localhost:8081/admin/ |

---

## 2. Tunnel 应该指向哪个端口？

**指向 `frontend:80`（而不是 backend）。**

这个项目是**同源设计**：Nginx 同时托管前端静态文件并反代 `/api`、`/admin`、`/static`。
所以：

```
✅ 正确：Cloudflare ──► frontend:80 ──┬── 静态文件
                                      └── /api/ ──► backend:8000

❌ 错误：Cloudflare ──► backend:8000   （前端拿不到，且要处理 CORS）
```

而且因为 cloudflared 跑在 compose 网络里，它直接用服务名 `frontend:80`，
**宿主机上 8081 / 8001 都可以不对公网暴露** —— 这是 tunnel 相比端口转发的最大好处。

---

## 3. 两种方式

### 方式 A · 快速 Tunnel（不需要账号，适合先试一下）

```bash
docker run -it --rm --network todolist_net \
  cloudflare/cloudflared:latest \
  tunnel --no-autoupdate --url http://frontend:80
```

终端会打印一个 `https://xxx-yyy-zzz.trycloudflare.com` 地址，
用浏览器打开即可。**关掉就失效**，域名每次都不一样，仅供测试。

> 用这个地址前记得把它加进 `DJANGO_ALLOWED_HOSTS`（见 §4），
> 否则 Django 会返回 `400 Bad Request (DisallowedHost)`。

### 方式 B · 命名 Tunnel（正式使用，推荐）

需要一个 Cloudflare 账号和一个托管在 Cloudflare 的域名。

**1. 创建 tunnel**

Cloudflare Dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**
→ 选 **Cloudflared** → 起个名字（如 `todolist`）→ 保存。

**2. 添加 Public Hostname（关键一步）**

在 tunnel 的 **Public Hostname** 标签页添加：

| 字段 | 值 |
| --- | --- |
| Subdomain | `todo`（或你想要的） |
| Domain | `example.com` |
| **Type** | **HTTP** |
| **URL** | **`frontend:80`** ← 用 Docker 服务名，不是 localhost |

**3. 复制 connector token**

安装页会给出一个 `eyJhIjoi...` 开头的长 token，把它写进 `.env`：

```env
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...
```

**4. 用 compose 起 tunnel**

```bash
docker compose --profile tunnel up -d cloudflared
```

`cloudflared` 已作为 `tunnel` profile 的服务写在 `docker-compose.yml` 里：
它加入 compose 网络、依赖 `frontend` 健康后启动、`restart: unless-stopped`。
**默认的 `docker compose up` 不会启动它。**

```bash
docker compose --profile tunnel logs -f cloudflared   # 看到 Registered tunnel connection 即成功
```

---

## 4. 必须同步修改的环境变量

Tunnel 生效后，Django 收到的 Host 和协议都变了，**这三项必须一起改**，否则会出现
`400 DisallowedHost` 或 admin 登录报 CSRF 错误：

```env
# 你的公网域名
PUBLIC_HOSTNAME=todo.example.com

# 允许的 Host（Django 会校验请求的 Host 头）
DJANGO_ALLOWED_HOSTS=todo.example.com

# 让 Django 认为请求是 https 的（Cloudflare 已经终止了 TLS）
DJANGO_SECURE_SSL=true

# admin 的 CSRF 校验需要完整的 https origin
CSRF_TRUSTED_ORIGINS=https://todo.example.com
```

改完重启：

```bash
docker compose up -d --force-recreate backend frontend
```

> `DJANGO_SECURE_SSL=true` 会打开：HSTS 一年（含子域 + preload）、
> Cookie Secure、HTTP→HTTPS 跳转。

### 已经处理掉的两个坑

**① Nginx 曾经覆盖 `X-Forwarded-Proto`**

链路是 `Cloudflare --HTTPS--> cloudflared --HTTP--> nginx --HTTP--> Django`。
Nginx 里原本写的是：

```nginx
proxy_set_header X-Forwarded-Proto $scheme;   # $scheme 永远是 http！
```

它会把 Cloudflare 传来的 `https` 覆盖成 `http`，于是 Django 认为请求不安全，
`SECURE_SSL_REDIRECT` 把它跳转到 https —— **而那一跳又是 http**，**无限重定向**。

现在改成保留上游的值：

```nginx
map $http_x_forwarded_proto $todolist_forwarded_proto {
    default $http_x_forwarded_proto;   # 有上游就用上游的
    ""      $scheme;                    # 直连本机时回落到连接协议
}
proxy_set_header X-Forwarded-Proto $todolist_forwarded_proto;
```

**② 健康检查会被 301 掉**

容器健康检查请求的是 `http://127.0.0.1:8000/api/v1/health/`。
开了 `SECURE_SSL_REDIRECT` 后它会被重定向，而 `curl -f` 对 3xx 依然返回 0 ——
**探针会变成空转**，容器显示 healthy 但根本没查数据库。已加入豁免：

```python
SECURE_REDIRECT_EXEMPT = [r"^api/v1/health/$"]
```

---

## 5. 强烈建议：再加一层 Cloudflare Access

Tunnel 只解决"能访问"，**Access 才解决"谁能访问"**。

Zero Trust → **Access** → **Applications** → **Add an application** → **Self-hosted**：

| 配置 | 值 |
| --- | --- |
| Application domain | `todo.example.com` |
| Policy | `Allow` + `Emails` = 你的邮箱 |
| Session duration | 例如 24 小时 |

这样打开网页会先过一次 Cloudflare 的邮箱验证码，**没通过的人连 Django 登录页都看不到**。
对个人自托管工具来说，这是性价比最高的一道防线。

> 开了 Access 之后 Cursor 的 MCP 不受影响 —— MCP 走的是
> `http://localhost:8001`，不经过 Cloudflare。

---

## 6. 验证

```bash
# 1) tunnel 连上了吗
docker compose --profile tunnel logs --tail=30 cloudflared | grep -i "Registered tunnel connection"

# 2) 公网地址
curl -sI https://todo.example.com/ | head -3          # 期望 200

# 3) API 健康检查（同源，走 tunnel）
curl -s https://todo.example.com/api/v1/health/ | python3 -m json.tool

# 4) HTTPS 跳转是否正常（不应循环）
curl -sI http://todo.example.com/ | head -3           # 期望 301 到 https，且只跳一次

# 5) 容器健康检查没被重定向搞坏
docker compose exec backend curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/api/v1/health/
```

第 5 条必须返回 **200**，不是 301。

---

## 7. 排错

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `400 Bad Request (DisallowedHost)` | `DJANGO_ALLOWED_HOSTS` 没加域名 | 见 §4 |
| **无限重定向** | 反向代理覆盖了 `X-Forwarded-Proto` | 本项目已修；若你自建代理，确保透传该头 |
| admin 登录报 CSRF 失败 | `CSRF_TRUSTED_ORIGINS` 缺 `https://` 前缀 | 见 §4 |
| `502` / `Unable to reach the origin` | URL 填了 `localhost:8081` | 改成 **`frontend:80`** |
| tunnel 容器起不来，日志说 token 无效 | `.env` 里 token 是空的或抄漏 | 重新复制 connector token |
| 网页能开但接口 401 | Cookie 被 `Secure` 标记，而你用 http 访问 | 一律用 https 地址访问 |
| 改了 `.env` 不生效 | compose 只在重建容器时读 | `docker compose up -d --force-recreate` |
| 健康检查变 301 | 未生效的 `SECURE_REDIRECT_EXEMPT` | 重建 backend 镜像 |

---

## 8. 安全清单

上公网前逐项确认：

- [ ] `DJANGO_SECRET_KEY` 是随机值（≥50 字符）
- [ ] `POSTGRES_PASSWORD` 已改强密码
- [ ] `DJANGO_DEBUG=false`
- [ ] `DJANGO_ALLOWED_HOSTS` 收窄到实际域名（**不要用 `*`**）
- [ ] `CSRF_TRUSTED_ORIGINS` 填了 `https://` origin
- [ ] `DJANGO_SECURE_SSL=true`
- [ ] **`API_HOST_PORT` 与 `POSTGRES_HOST_PORT` 的端口映射已移除**（见下）
- [ ] Cloudflare Access 已开启
- [ ] 反向代理层对 `/api/v1/auth/` 限流（**应用层目前没有登录限流**）
- [ ] 备份任务已配置（`./scripts/backup.sh`）

### 彻底不暴露宿主机端口

Tunnel 只需 compose 内网，所以公网部署时可以把端口映射去掉或只绑本机：

```yaml
  frontend:
    ports:
      - "127.0.0.1:${WEB_PORT:-8081}:80"   # 加 127.0.0.1 前缀 = 只监听本机
```

或者直接删掉 `backend` 和 `db` 的 `ports:` 段 —— 反正 tunnel 走的是服务名。
（保留绑定只是为了本机调试方便。）
