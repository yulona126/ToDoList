# ToDoList · 项目理解数据库（Project Brain）方案

> 目标：让 AI 在改代码之前，先知道**这个项目为什么是现在这样**。
> 定位：ToDoList 从一个"待办工具"演进成 **AI 编码时的外置项目记忆**。

---

## 1. 先定义问题：vibecoding 到底错在哪

把一次失败的 AI 改动拆开，失败原因几乎从不是"代码写不出来"，而是这五类：

| # | 失败模式 | 例子 |
| --- | --- | --- |
| F1 | 不知道约定，于是发明新约定 | 项目里所有错误都走统一信封，AI 新写了个接口直接 `raise` 裸异常 |
| F2 | 不知道约束，于是破坏它 | 有 ADR 明确禁止在请求路径里做同步 HTTP，AI 又加了一个 |
| F3 | 重复解决已解决的问题 | 半年前已经论证过并否决的方案，AI 重新提一遍 |
| F4 | 与既有决策冲突 | refresh token 的轮换语义被改掉，破坏了黑名单假设 |
| F5 | 不知道有并发工作在改同一块 | 另一个任务正在重构同一模块，两边打架 |

**这五条全是知识失败，不是代码失败。** 而代码索引解决不了其中任何一条 —— 因为代码里只有 What，没有 Why。

### 结论

> **不要做"代码 RAG"。要做"为什么"的数据库。**

---

## 2. 为什么不能只做代码语义检索

必须先说清楚这一点，否则很容易做出一个**比 Cursor 自带的更差**的东西：

| 能力 | Cursor 已有 | 我们再做一个的价值 |
| --- | --- | --- |
| 代码库语义索引 | ✅ 且持续维护 | **负价值** —— 更差更慢更贵 |
| 文件树 / 符号跳转 | ✅ LSP | 负价值 |
| 全文检索代码 | ✅ | 负价值 |
| 跨会话记住决策 | ❌ | **正价值** |
| 知道某模块的历史权衡 | ❌ | **正价值** |
| 知道哪些知识已经过期 | ❌ | **正价值** |
| 知道同一模块有并发工作 | ❌ | **正价值** |

**所以边界很清楚：不碰代码检索，只做代码无法表达的层。**

代码本体不进库。库里只放**指向代码的指针 + 人的判断**。

---

## 3. 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│ Cursor / Claude Code / CLI                                        │
│   └─ MCP: get_context(paths) / search_knowledge / record_decision │
└───────────────────────────────┬──────────────────────────────────┘
                                │ HTTP + Bearer
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│ Django (apps/brain)                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ 知识层       │  │ 检索层        │  │ 陈旧检测                │  │
│  │ Document    │  │ 结构化查询    │  │ anchor_commit vs HEAD   │  │
│  │ Decision    │  │ + 向量召回    │  │ → needs_review          │  │
│  │ Note        │  │ + RRF 融合    │  │                         │  │
│  │ Module      │  │ + 预算裁剪    │  │                         │  │
│  │ CodeAnchor  │  └──────────────┘  └─────────────────────────┘  │
│  └─────────────┘                                                 │
└───────────┬──────────────────────────────────┬───────────────────┘
            │                                  │
            ▼                                  ▼
   ┌──────────────────┐              ┌────────────────────┐
   │ Postgres         │              │ Repo (git)         │
   │ + pgvector       │              │ 只读引用，不复制内容 │
   │ + pg_trgm        │              │ 取 commit / diff    │
   └──────────────────┘              └────────────────────┘
                                              ▲
                                    本地 embedding 模型（可选）
                                    bge-m3 / ONNX，数据不出机器
```

三条硬性设计原则：

1. **不复制文件内容。** 文档在 git 里就是唯一事实源，库里只存
   `path + content_hash + 向量 + 锚点 + 复核状态`。
   复制一份进库 = 制造第二个事实源 = 必然分叉。
   （这就是为什么**不做"项目文件管理"** —— git 已经是文件管理器了。）
2. **不用只靠向量。** 结构化条件（模块、路径、状态、类型）能精确回答的，
   绝不交给相似度。向量只用于"我记不清具体用词"的模糊召回。
3. **输出必须有预算。** 上下文不是越多越好。塞满窗口会让准确率**下降**
   （lost-in-the-middle），而且贵。每次检索给固定 token 预算，按优先级裁剪。

---

## 4. 数据模型

### 4.1 知识实体

```python
class Repo(TimeStampedModel):
    """一个被纳管的 git 仓库。"""
    workspace = FK(Workspace, related_name="repos")
    name = CharField(64)
    path = CharField(512)              # 容器内可见路径，如 /repos/myapp
    remote_url = CharField(512, blank=True)
    default_branch = CharField(64, default="main")
    last_indexed_commit = CharField(40, blank=True)
    last_indexed_at = DateTimeField(null=True)


class Module(TimeStampedModel):
    """项目里一个逻辑模块。可以有层级（parent）。"""
    workspace = FK(Workspace, related_name="modules")
    repo = FK(Repo, null=True, on_delete=SET_NULL)
    parent = FK("self", null=True, related_name="children")
    name = CharField(80)
    slug = SlugField()                 # auth / billing / pwa
    summary = TextField(blank=True)    # 一句话职责
    path_globs = JSONField(default=list)   # ["apps/accounts/**"]
    owner = FK(User, null=True, on_delete=SET_NULL)
    is_archived = BooleanField(default=False)
    class Meta:
        constraints = [UniqueConstraint(fields=["workspace","slug"], name="uniq_module_slug")]


class Document(TimeStampedModel):
    """一条知识。内容在 git 里，这里只存指针与派生数据。"""
    class Kind(TextChoices):
        DECISION = "decision"     # ADR
        SPEC = "spec"
        RUNBOOK = "runbook"
        NOTE = "note"
        GLOSSARY = "glossary"
    class Status(TextChoices):
        DRAFT, ACCEPTED, SUPERSEDED, REJECTED = ...

    workspace = FK(Workspace, related_name="documents")
    module = FK(Module, null=True, on_delete=SET_NULL, related_name="documents")
    kind = CharField(16, choices=Kind.choices)
    status = CharField(16, choices=Status.choices, default=ACCEPTED)
    title = CharField(200)

    # 内容来源：要么在 git 里（path），要么是库内短文（body）
    repo = FK(Repo, null=True, on_delete=SET_NULL)
    path = CharField(512, blank=True)      # repo 相对路径
    body = TextField(blank=True)           # 仅短笔记用
    content_hash = CharField(64, blank=True)   # 检测文件被改过

    superseded_by = FK("self", null=True, on_delete=SET_NULL)
    author = FK(User, null=True, on_delete=SET_NULL)
    tags = M2M(Tag, blank=True)

    # 陈旧检测
    anchor_commit = CharField(40, blank=True)   # 写下/复核时的 commit
    verified_at = DateTimeField(null=True)
    needs_review = BooleanField(default=False)
    review_reason = CharField(200, blank=True)


class CodeAnchor(TimeStampedModel):
    """知识 ↔ 代码位置。这是整个系统的枢纽。"""
    workspace = FK(Workspace, related_name="anchors")
    document = FK(Document, null=True, on_delete=CASCADE, related_name="anchors")
    task = FK(Task, null=True, on_delete=CASCADE, related_name="anchors")
    module = FK(Module, null=True, on_delete=SET_NULL, related_name="anchors")
    repo = FK(Repo, null=True, on_delete=SET_NULL)
    path = CharField(512)                 # 相对路径，支持 glob
    symbol = CharField(200, blank=True)   # 可选：类/函数名
    note = CharField(300, blank=True)     # "这里有个坑"


class Chunk(TimeStampedModel):
    """Document 的切片 + 向量。没有 embedding 服务时这一层可以为空。"""
    document = FK(Document, on_delete=CASCADE, related_name="chunks")
    ordinal = IntegerField()
    text = TextField()
    token_count = IntegerField(default=0)
    # pgvector.django.VectorField（pgvector 0.5.x）；维度由所选模型决定
    embedding = VectorField(dimensions=1024, null=True)   # bge-m3 = 1024 维
    tsv = SearchVectorField(null=True)                    # 词法检索


class CommitEvent(TimeStampedModel):
    """git 提交摘要，用于陈旧检测与"最近动过什么"。"""
    repo = FK(Repo, on_delete=CASCADE, related_name="commits")
    sha = CharField(40, db_index=True)
    message = TextField(blank=True)
    authored_at = DateTimeField()
    changed_paths = JSONField(default=list)
    class Meta:
        constraints = [UniqueConstraint(fields=["repo","sha"], name="uniq_repo_sha")]
```

### 4.2 为什么 `CodeAnchor` 是关键

有了它才能回答"改这个文件前该知道什么"：

```sql
-- 给定用户正在编辑的文件，找出所有相关知识
SELECT d.* FROM documents d
JOIN code_anchors a ON a.document_id = d.id
WHERE a.path = %s OR %s LIKE a.path_glob
```

没有锚点，就只剩全库语义检索 —— 噪声大、成本高、还容易漏。

**锚点的写入时机**：写决策时顺手选文件；或让 agent 调 `record_decision(paths=[...])` 自动带上。

---

## 5. 检索设计

### 5.1 双索引

| 索引 | 存什么 | 回答什么 | 成本 |
| --- | --- | --- | --- |
| **结构化**（Postgres） | module / path / status / kind / anchor | "auth 模块有哪些已接受的决策" | 极低，精确 |
| **词法**（`tsvector` + `pg_trgm`） | 标题/正文 | "哪篇文档提过 refresh" | 低 |
| **向量**（pgvector） | chunk embedding | "我记不清用词了，关于会话续期的那些权衡" | 中 |

### 5.2 混合排序（RRF）

```
score(d) = w_struct · struct_hit(d)
         + w_lex   · 1/(60 + rank_lex(d))
         + w_vec   · 1/(60 + rank_vec(d))
         + w_recency · decay(d.updated_at)
         - w_stale · (1 if d.needs_review else 0)
```

权重先给经验值（`struct 1.0 / lex 0.7 / vec 0.5 / stale 0.3`），
再用 §11 的评估集调。**不要凭感觉调，要有对照。**

### 5.3 输出预算：`get_context` 的契约

这是整个系统的产品形态。目标 **≤ 1500 token**，按优先级占位：

```
# auth 模块上下文

## ⚠ 需谨慎采信（2）
- ADR-004 refresh 轮换：写于 43 个提交前，期间 apps/accounts/ 有 12 处改动
- note「session 中间件顺序」：锚定文件已删除

## 决策（已接受）
- ADR-004 refresh token 轮换 + 黑名单（docs/adr/004-refresh.md）
- ADR-011 密码校验统一走 AUTH_PASSWORD_VALIDATORS

## 进行中的任务（2）
- #152 统一错误码 · 进行中 · 高 — 会改 serializers.py
- #161 加 MCP token 鉴权 · 待办

## 硬约束
- 禁止引入 Celery（ADR-002）
- 请求路径内不做同步外部调用（ADR-007）

## 相关文件（按锚点密度）
- apps/accounts/models.py    ← 3 条知识
- apps/accounts/serializers.py ← 2 条
```

三条规则：
1. **陈旧信号排在最前。** 让 AI 先知道"哪些别全信"，比多塞 3 篇文档有用。
2. **每条都带出处**（文件路径 / ADR 编号），AI 可以按需再拉。
3. **超预算时按优先级截断，并显式说明截断了什么** —— 不要静默丢。

---

## 6. 陈旧检测（核心差异化）

知识库最大的失败模式不是"没有"，而是**过期的知识被自信地引用**。
那比没有更危险，因为它带着权威感。

### 机制

每个 `Document` 记录 `anchor_commit`。后台任务定期：

```
1. 取 repo 的 HEAD
2. diff(anchor_commit..HEAD, 只看该文档锚定的路径)
3. 有改动 → needs_review = True，写入 review_reason
4. 在 MCP 输出里显式标注
```

### 为什么这个信号只有我们能给

- git 知道文件变了，但**不知道哪条决策因此可能失效**
- AI 不知道这条决策当初是基于什么前提
- **只有把"知识"和"代码位置"显式连起来的系统才能算这个差集**

这是本方案里最有价值、也最难被替代的部分。

### 复核动作要极轻

```bash
# MCP
get_stale_knowledge()          # 列出待复核
confirm_document(id)           # 仍成立 → verified_at 更新，anchor_commit 前移
supersede_document(id, by=…)   # 被取代
```

> 如果复核比重写还麻烦，用户就不会复核，库就开始腐烂。
> **复核必须是一次调用或一次点击。**

---

## 7. MCP 工具面

**刻意只加 4 个**（工具定义本身占用模型上下文，且每次调用都是延迟）。

| 工具 | 作用 |
| --- | --- |
| **`get_context(paths?, module?, task_id?)`** | **旗舰**。给文件路径或模块，返回 §5.3 的预算化上下文包 |
| `search_knowledge(query, module?, kind?)` | 混合检索，用于追问 |
| `record_decision(title, body, paths[], module?, status?)` | **写回**：把刚做的决策记下来 |
| `record_note(paths[], note, module?)` | 轻量"我学到一件事"，拴在文件上 |

### 为什么把入口收敛成一个 `get_context`

如果暴露 6 个细粒度工具，模型每次都要自己编排"先查模块→再查决策→再查任务"：
多 3 次往返、多烧 token、多 3 个出错机会。

**一个入口，服务端编排。** 模型只需要说"我要改这两个文件"。

### `record_decision` 是闭环的关键

只有读没有写的知识库必然腐烂 —— 因为新鲜知识永远留在对话里。
让 agent 在得出结论时顺手写回，维护成本才接近零。

```
Cursor: [改完 auth 的错误码，调 record_decision]
        title: "统一错误码格式"
        body: "所有 4xx 走 {detail, errors} 信封，与 DRF 默认一致"
        paths: ["backend/apps/accounts/views.py", "backend/apps/common/exceptions.py"]
        module: auth
```

---

## 8. 知识怎么进来（维护模型）

按"用户付出"从低到高：

| 来源 | 用户成本 | 覆盖 |
| --- | --- | --- |
| **agent 写回**（`record_decision` / `record_note`） | 零 | 开发过程中自然产生 |
| **任务完成时补一句结论** | 极低 | 与已有 ToDoList 流程天然结合 |
| **批量导入仓库现有文档** | 一次性 | `docs/**/*.md`、`README`、ADRx、`CONTRIBUTING` |
| **git 提交摘要** | 零（自动） | 用于陈旧检测与"最近动过什么" |
| **手工在 UI 写 ADR** | 高 | 重大决策 |

**批量导入是冷启动的关键**：第一次接入时，把仓库里已有的 markdown 全部索引一遍，
再让用户给它们指定模块与锚点。这样第一天就有内容，而不是从空白开始。

---

## 9. 技术选型

| 项 | 选择 | 理由 |
| --- | --- | --- |
| 向量存储 | **pgvector**，`pgvector/pgvector:pg17` 镜像（已确认存在）+ `pgvector` 0.5.1 | 不引入第二个数据库；与主数据同一事务；删除一致性天然成立 |
| 词法检索 | Postgres `tsvector` + `pg_trgm` | 中文没有 `zhparser` 时 trigram 仍可用；零额外依赖 |
| Embedding | **本地 `bge-m3`**（`fastembed` 0.9.0 / ONNX，CPU 可跑） | 私有项目库**不该把代码旁的文档发出去**；且无按次成本 |
| 降级模式 | 无 embedding 时纯结构化 + 词法 | 功能仍可用，只是模糊召回变弱。**不能因为模型没装就整体不可用** |
| git 访问 | 只读挂载 repo 目录 + `git` 子进程 | 不引 dulwich 之类的重依赖 |
| 代码符号 | 阶段 P4 再上 tree-sitter | 前四阶段用 path globs + git 就够，先别做符号图 |
| 后台任务 | 复用 `entrypoint` 里的管理命令 / `cron` 容器 | P0 不引 Celery（见风险 R4） |

> Embedding 一定要**可插拔**：本地模型是默认，但允许配置成远程 API。
> 有人愿意用 API 换质量，有人一台机器都不想连 —— 两种需求都真实存在。

---

## 10. 实施阶段

每一阶段都能**独立交付价值**，不需要等全部做完。

| 阶段 | 内容 | 交付价值 | 估时 |
| --- | --- | --- | --- |
| **P0** | Document / Module / CodeAnchor 模型 + 批量导入 + 结构化检索 + `get_context`（无向量） | 改代码前能看到相关决策与任务 | 4 人日 |
| **P1** | `record_decision` / `record_note` + 任务结论沉淀 | 知识开始自动积累（闭环） | 2 人日 |
| **P2** | pgvector + 本地 embedding + 混合排序 + RRF | 模糊召回 | 3 人日 |
| **P3** | git 锚定 + 陈旧检测 + `get_stale_knowledge` | **核心差异化** | 3 人日 |
| **P4** | tree-sitter 符号索引 + 依赖图（`get_module` 给出上下游） | 影响面分析 | 5 人日 |
| **P5** | 评估集 + 权重调优 + 检索质量回归测试 | 不退化 | 2 人日 |

**建议先做 P0 + P1 + P3**（约 9 人日）：不引入向量库也能拿到 80% 的价值 ——
因为"锚点 + 陈旧信号"才是差异化，向量只是锦上添花。

---

## 11. 怎么知道它真的有用（评估）

这是最容易被跳过、也最不该跳过的一步。没有评估，调优就是凭感觉。

### 建一个 20 题的评估集

```jsonc
{
  "question": "改 apps/accounts/serializers.py 之前我该知道什么？",
  "must_include": ["ADR-004", "密码校验走 validators"],
  "must_not_include": ["ADR-002"],          // 与 accounts 无关
  "budget_tokens": 1500
}
```

指标：

| 指标 | 目标 | 说明 |
| --- | --- | --- |
| **召回率** | ≥ 90% | `must_include` 出现的比例 |
| **精确率** | ≥ 80% | 输出里无关内容占比 |
| **陈旧标注正确率** | ≥ 95% | 标了 review 的确实该标 |
| **平均 token** | ≤ 1500 | 超了就是检索没做够，靠塞上下文掩盖 |

每次改权重/改 prompt 都跑一遍。**否则一定会发生"感觉变好了，其实退化了"。**

---

## 12. 风险与明确的"不做"

| # | 风险 | 应对 |
| --- | --- | --- |
| R1 | **维护负担 > 收益** → 库荒废 | 写回成本必须接近零（agent 自动 + 任务结论）；复核一次调用 |
| R2 | **过期知识比没有更糟** | 陈旧检测是 P3 必做项，不是可选项；输出里显式标注置信度 |
| R3 | **上下文塞太多反而更差** | 硬预算 + 优先级截断 + 评估集盯住 token 均值 |
| R4 | 引入 Celery/Redis 使部署变重 | 陈旧检测用低频 cron 容器或管理命令，P0–P3 不引消息队列 |
| R5 | 向量检索把结构信息淹没 | 结构化权重最高；向量只做补充召回 |
| R6 | 私有代码/文档外泄 | 默认本地 embedding；远程 API 必须显式开启并提示 |
| R7 | 文档与库内容分叉 | **绝不复制正文**，只存指针 + hash；正文只有 git 一份 |
| R8 | 索引爆炸（大仓库） | 只索引 `docs/**` 与显式声明的路径；代码本体永不入库 |

### 明确不做

- ❌ **不做代码语义检索** —— Cursor 已经做了，且做得更好（§2）
- ❌ **不做项目文件管理** —— git 就是文件管理器。我们只引用，不托管
- ❌ **不做"自动读懂整个项目"** —— 那是幻觉。我们做的是**人写下的判断 + 精确锚点**
- ❌ **不做全库向量暴力检索** —— 先结构化收窄，再向量补充
- ❌ **不自动生成决策文档** —— 让 AI 编 ADR 会产出看似合理但无人认可的噪声，
      比空着更糟。决策必须有人（或至少有人确认过）的输入

---

## 13. 与现有系统的关系

```
ToDoList（已有）              Project Brain（本方案）
─────────────────            ──────────────────────────
Workspace    ──────────────►  同一 Workspace 作为隔离边界
Task         ◄──────────────► CodeAnchor：任务锚定到文件/模块
Tag          ◄──────────────► Document 打标签
AI 录入      ──────────────►  文本 → 任务
MCP 4 工具   ──────────────►  扩展为 6 工具（+get_context/search/record）
```

关键复用：

- **Workspace 仍是隔离与权限的唯一锚点**（`for_user()` 那套原样适用）
- **CodeAnchor 同时挂在 Task 和 Document 上** → "这个文件上有哪些待办和相关决策"
  是一次查询就能拿到的
- **AI 录入的本地解析器思路可以复用**：能从结构化输入确定的东西，
  不要交给模型

---

## 14. 一句话总结

> Cursor 让 AI 读得懂**代码**。
> 这个方案让 AI 读得懂**你**——你的取舍、你的约束、你踩过的坑，
> 并且**诚实地告诉你哪些可能已经过时**。

前者已经很好，后者没人做。**做后者。**
