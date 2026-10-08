# ToDoList · 演进路线

V1 的取舍原则：**先把数据模型和查询边界做对，功能可以慢慢加。**
因此下面的每一项都标注了「是否需要迁移」，凡是标记 ❌ 的，说明 V1 已经为它留好了地基。

---

## V1.1 — 安全加固 ｜ 1.5 人日 ｜ 需要迁移 ⚠️（仅新增表）

**为什么优先**：当前应用层没有登录限流，是最现实的攻击面。

| 事项 | 做法 | 迁移 |
| --- | --- | --- |
| 登录限流 | 引入 `django-axes`，按 IP + 账号锁定 | ⚠️ 新增表 |
| refresh token 存储强化 | 改为 HttpOnly + SameSite=Strict Cookie + CSRF 双提交 | ❌ |
| CSP 收紧 | Nginx 下发 `Content-Security-Policy`，去掉 `unsafe-inline` | ❌ |
| 审计日志 | 记录登录失败、密码修改、工作区删除事件 | ⚠️ 新增表 |
| 依赖漏洞扫描 | CI 中加 `pip-audit` + `npm audit` | ❌ |
| 前端单元测试 | 引入 Vitest + Testing Library，覆盖 hooks 与乐观更新回滚 | ❌ |
| 路由级代码分割 | `React.lazy` 拆 Settings/NotFound，消除 500 KB chunk 告警 | ❌ |

---

## V1.2 — 共享工作区 ｜ 3 人日 ｜ 需要迁移 ❌

**这是 V1 架构时就明确预留的能力。**

已经就绪的部分：

- `Workspace.members`（M2M → User，through `WorkspaceMember`）表结构已存在
- `WorkspaceMember.role` 已有 `owner/admin/member/viewer` 四档
- `Workspace.visibility` 已有 `private/shared` 开关位
- 所有查询已通过 `Workspace.objects.for_user()` 收敛，**同时匹配 owner 与 member**

需要新增：

| 事项 | 内容 |
| --- | --- |
| 接口 | `POST /workspaces/{id}/members/invite/`、`PATCH .../members/{uid}/`（改角色）、`DELETE` |
| 邀请链路 | 邀请 token 表 + 邮件发送（或直接生成邀请链接） |
| 权限细化 | `viewer` 只读；`member` 可写任务；`admin` 可改工作区设置；`owner` 可删除 |
| 前端 | 成员管理页、成员头像、任务上的「谁在做」 |
| 冲突提示 | 同一任务被两人同时编辑时的乐观锁（`updated_at` 比对） |

---

## V1.3 — 视图升级：看板与时间线 ｜ 2.5 人日 ｜ 需要迁移 ❌

| 事项 | 内容 |
| --- | --- |
| 看板视图 | 按 `status` 分四列，拖拽改状态与顺序 |
| 后端 | 复用已有的 `POST /tasks/reorder/`（已支持 `sort_order` + `task_list`） |
| 时间线 | 按 `due_date` 排布的周视图 |
| 收件箱 | 专门的未分组任务视图 |

---

## V1.4 — 离线写入 ｜ 4 人日 ｜ 需要迁移 ⚠️

V1 只做到"离线可读"。真正的离线写入需要解决冲突。

| 事项 | 内容 |
| --- | --- |
| 幂等键 | `Task.client_id`（UUID，唯一）避免重复提交 | ⚠️ 新增列 |
| 写队列 | IndexedDB 存待发请求，`online` 事件触发重放 |
| 冲突策略 | 默认 last-write-wins + 冲突提示；重要字段（status）用向量时钟 |
| 同步提示 | 顶部「N 项待同步」指示器 |
| 后台同步 | Background Sync API |

---

## V1.5 — 检索与通知 ｜ 4 人日 ｜ 需要迁移 ⚠️（仅索引）

| 事项 | 内容 |
| --- | --- |
| 全文检索 | PostgreSQL `pg_trgm` + GIN 索引，中文用 `zhparser` 或退化为 `icontains` | ⚠️ 仅索引 |
| 保存的筛选 | `SavedFilter` 表，把常用组合存成视图 | ⚠️ 新增表 |
| Web Push | VAPID + `pywebpush`，到期提醒、每日摘要 |
| 邮件摘要 | 每日 9:00 推送"今天到期 + 逾期 + 进行中" |

---

## V2.0 — AI 协同 ｜ 8 人日 ｜ 需要迁移 ⚠️

这一步才是这个工具真正的差异化：**把 AI 对话的产物直接沉淀为可执行待办。**

| 能力 | 说明 |
| --- | --- |
| 会议纪要 → 任务 | 粘贴一段纪要，自动抽取 `title` / `task_type=meeting` / 责任人 / 截止日 |
| 需求文档 → 任务树 | 把一份 PRD 拆成清单 + 任务 + 子任务 |
| 每日上下文摘要 | 早上生成"你昨天没做完的 3 件事 + 今天到期 2 件" |
| 任务自动排期 | 根据优先级与截止日给出今日建议顺序 |
| 自然语言录入 | 「下周三前和设计对一下登录流程」→ 一条 `communication` 类型任务 |

技术形态：后端加 `apps/assistant/`，封装 LLM 调用，**结构化输出走 function calling**，
所有生成结果先落到「草稿区」由用户确认，避免 AI 直接污染任务列表。

---

## 长期不做（明确的非目标）

| 项 | 原因 |
| --- | --- |
| 甘特图 / 复杂项目排期 | 会让工具变重，违背"随手记录"的定位 |
| 原生 App | PWA 已覆盖安装需求，双端维护成本不值 |
| 团队即时通讯 | 那是 Slack/飞书的领域，不重复造 |
| 多租户 SaaS 化 | 定位是自托管个人/小团队工具 |
| 富文本编辑器 | 纯文本 + Markdown 足够，富文本会带来 XSS 与存储复杂度 |

---

## 版本节奏建议

```
V1.1 安全加固 ──► V1.2 共享工作区 ──► V1.3 看板
                                        │
                                        ▼
                          V1.5 检索通知 ──► V2.0 AI 协同
                                        ▲
                                        │
                                  V1.4 离线写入
```

建议顺序理由：安全是底线；共享是 V1 已付费的地基（不做就浪费了）；
看板是最高频的体验诉求；离线写入与 AI 协同价值最高但成本也最高，放在数据模型稳定之后。
