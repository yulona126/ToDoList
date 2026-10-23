# ToDoList · 阶段流水线（敏捷开发流程）方案

> 你要的流程：**Plan Meeting → 验证需求 → 设计开发 → 自测**
> 本方案把它落成数据模型 + 视图 + 闸门，并且只加一个维度。

---

## 1. 先把你的流程拆清楚

你描述的四步，其实是**四个阶段 + 四个产出物**。产出物才是关键 ——
没有产出物的"阶段"就会退化成装饰性的状态标签（这正是 `doing` 现在的处境）。

| # | 阶段 | 进入这一阶段意味着 | **产出物（Definition of Ready/Done）** |
| --- | --- | --- | --- |
| 1 | **需求** | Plan Meeting 开完了 | 一句话需求 + **验收标准**（怎么算做完） |
| 2 | **验证** | 需求真伪/可行性在查 | **结论**：可行 / 有风险（风险是什么）/ 不做 |
| 3 | **开发** | 设计和实现 | 代码 +（重要时）一条决策记录 |
| 4 | **自测** | 改完了，在自查 | **怎么测的 + 结果** |
| 5 | **完成** | 交付 | —（`completed_at` 打点） |

### 关键判断

> **阶段的真正用途不是"看板好看"，而是能算出每一步花了多久、卡在哪一步。**

一个只有 4 列好看的看板，用两周就会疲。但"**你的自测阶段平均积压 5 条、平均停留 6 天**"
这个结论会逼你改流程 —— 这才是敏捷的本意。

所以本方案的重心是 **`stage_entered_at` 时间戳**，不是拖拽动画。

---

## 2. 数据模型：stage 是唯一真相，status 变成派生值

### 2.1 为什么不能直接加一个 stage 字段

同时存在 `status` 和 `stage` 两个重叠维度 → 用户永远不知道哪个该改 → 两个都会烂。
你 `doing` 用了 0 次，正是"字段太多、每个都不值得维护"的结果。

### 2.2 正确做法：一个维度 + 一个正交标志

```python
class Stage(TimeStampedModel):
    """工作区的阶段定义。允许每个工作区不同的流水线。"""
    workspace = FK(Workspace, related_name="stages")
    name = CharField(40)                  # 需求 / 验证 / 开发 / 自测 / 完成
    order = IntegerField()
    is_terminal = BooleanField(default=False)   # 完成：进入即打 completed_at
    wip_limit = IntegerField(null=True, blank=True)  # 可选：这一列最多同时几条
    gate_prompt = CharField(200, blank=True)    # 进入时问的一句话
    class Meta:
        ordering = ("order",)
        constraints = [UniqueConstraint(fields=["workspace", "order"], name="uniq_stage_order"),
                       UniqueConstraint(fields=["workspace", "name"], name="uniq_stage_name")]


class Task(TimeStampedModel):
    ...
    stage = FK(Stage, null=True, blank=True, on_delete=PROTECT, related_name="tasks")
    stage_entered_at = DateTimeField(null=True, blank=True, db_index=True)
    is_blocked = BooleanField(default=False)          # 正交：任何阶段都可能被阻塞
    blocked_reason = CharField(200, blank=True)
```

### 2.3 `status` 改为**派生但落库**（不是 Python property）

先纠正一个容易想当然的做法：把 `status` 写成 `@property`。

**不行。** 实测影响面：

```
后端 ORM 里 status= 的用法： 42 处（不含测试）
其中最要命的是聚合注解：
  Count("tasks", filter=Q(tasks__status="done"), distinct=True)
  ↑ 这是 SQL 层的东西，无法调用 Python property
```

一旦 `status` 不是真实列，`WorkspaceQuerySet.with_stats()`、
`TaskSerializer` 的统计回落、`TaskFilter` 的状态筛选、`TaskViewSet.bulk`
的 `queryset.update(status=...)` 全部失效。

### 正确做法：`stage` 是输入的唯一真相，`status` 是**同步写入数据库的派生列**

```python
def compute_status(self) -> str:
    if self.is_blocked:
        return "blocked"
    if self.stage is None or self.stage.order <= 0:
        return "todo"
    if self.stage.is_terminal:
        return "done"
    return "doing"

def save(self, *args, **kwargs):
    # 单一真相是 stage；status 每次保存时重算并落库，
    # 这样既保留了既有 42 处 ORM 查询与聚合，又不会两边分叉。
    self.status = self.compute_status()
    super().save(*args, **kwargs)
```

**代价与注意点（必须写进实现清单）：**

| 事项 | 处理 |
| --- | --- |
| `queryset.update(...)` 绕过 `save()` | `bulk` / `reorder` 等批量操作必须**同时**更新 `stage` 与 `status` |
| 阶段推进 | 统一走 `Task.advance_to(stage)`，内部改 `stage` + `stage_entered_at` 再 `save()` |
| 写入 `status`（旧 API） | 反向映射到阶段，再由 `save()` 重新算出 `status` |
| 每阶段计数 | 新增 `stats.by_stage`，旧的 todo/doing/blocked/done 四个值保留（向后兼容） |

这样迁移是**真正无破坏的**：前端、MCP 四个工具、E2E 72 条断言都不必同时改。
看板可以晚一步上，旧接口继续按原样工作。

### 2.4 迁移（57 done / 12 todo，无损）

```
done   → 进入"完成"阶段，保留 completed_at
todo   → 停在"需求"
doing  → 进入"开发"      （当前 0 条，无数据风险）
blocked→ 进入"开发" + is_blocked=True（当前 0 条）
```

---

## 3. 闸门：让阶段有质量含义

每个阶段可以配一句 `gate_prompt`，进入该阶段时**轻提示**（可跳过）：

| 进入阶段 | 提示 |
| --- | --- |
| 需求 | 「验收标准是什么？（怎么算做完）」 |
| 验证 | 「结论：可行 / 风险：___ / 不做」 |
| 开发 | 「有没有需要记下来的决策？」 |
| **自测** | 「怎么测的？结果？」 |

### 只有最后一道是强制的

`自测 → 完成` 要求填一句**测试证据**（测试方式 + 结果）。
其余全部可选、可跳过。

理由：**每条都强制会让人直接关掉这个功能**（这是你 `doing` 用 0 次的教训）；
但"声称做完"这一个动作值得留一句话 —— 因为这里是唯一自欺成本最高的地方。

> 这句话会存进任务的阶段历史，之后 `get_context` 可以把它带给 AI：
> "这条代码当时的自测方式是 X" —— 比让 AI 猜强得多。

---

## 4. 视图：Board 为主，List 保留

### 4.1 Board（默认视图）

```
┌ 需求 (8) ┬ 验证 (2/3) ┬ 开发 (4/4) ┬ 自测 (5 ⚠) ┬ 完成 ┐
│          │            │  ⚠ 已达上限 │  ⚠ 积压    │      │
│ [DL005]  │ [IS-1]     │ [DL012]    │ [DL008]    │      │
│  1 天    │  3 天      │  12 天     │  21 天 ⚠   │      │
└──────────┴────────────┴────────────┴────────────┴──────┘
```

每张卡上除了标题，**必须有**：

| 元素 | 作用 |
| --- | --- |
| **停留天数** | `now - stage_entered_at`。**这是整个方案最有用的一个数字** |
| 优先级 / 类型 图标 | 已有字段，复用 |
| 阻塞标记 `!` | `is_blocked` |
| 子任务进度 `1/2` | 已有 |

**不做拖拽。** 卡片上放 `→` 按钮移动到下一阶段。
理由：拖拽在移动端不可用、误触率高，而且你本来就不维护状态 ——
一个明确的"推进"按钮比拖拽更可能被点。

> 如果你坚持要拖拽，也可以加，但不该是第一版的重心。

### 4.2 停留天数的告警

```
阈值 = 该阶段历史停留时间的中位数 × 2   （数据不足 5 条时用固定值：需求 14 天 / 开发 21 天 / 自测 7 天）
```

超过 → 卡片右下角 `⚠`，且 **Board 顶部汇总一行**：
「自测积压 5 条，最久 21 天」—— 这行字比任何图表都直接。

### 4.3 List 视图保留

按清单分组的现有视图不动。**两种视图对应两种任务**：
Board 用于"推进"，List 用于"找东西"。

---

## 5. 真正值钱的指标：阶段停留时间

这才是本方案相对"换个状态字段"的全部价值。

```
GET /api/v1/analytics/flow/?days=30
```

```jsonc
{
  "throughput_per_week": 11,          // 每周完成数
  "avg_lead_time_hours": 52.3,        // 创建 → 完成
  "stages": [
    { "name": "需求", "avg_hours": 18.2, "wip": 8, "slack": "宽松" },
    { "name": "验证", "avg_hours": 4.1,  "wip": 2, "slack": "宽松" },
    { "name": "开发", "avg_hours": 22.8, "wip": 4, "slack": "正常" },
    { "name": "自测", "avg_hours": 6.4,  "wip": 5, "slack": "积压" }  // ← 瓶颈
  ],
  "bottleneck": "自测"
}
```

一句话结论：

> **你的瓶颈在「自测」：平均等了 6.4 小时，同时积压 5 条。**
> 因为开发阶段产出太快，自测没人清。

这是敏捷里唯一值得看的单人指标（Little's Law：`WIP = 吞吐 × 停留时间`）。
有了它，你才知道该优化哪一段，而不是笼统地"提高效率"。

---

## 6. 与现有系统的衔接

| 已有能力 | 怎么接 |
| --- | --- |
| **AI 录入**（Plan Meeting 纪要 → 任务） | 新建任务默认进「需求」阶段。会议产出天然落在第一列 |
| **`record_decision`（MCP）** | 决策锚定到任务 + 文件，在「开发」阶段可见 |
| **MCP `get_tasks`** | 增加 `stage` 过滤；`get_context` 可带"这条任务的自测方式" |
| **subtask** | 子任务**不参与**阶段流转（跟随父任务），否则看板会被子任务淹没 |
| **周迭代（docs/agile.md）** | **可选叠加**：承诺闸门管"接多少"，阶段流水线管"走到哪"。两者正交，不冲突 |

> ⚠️ **不要同时开两个新维度**。建议先上阶段流水线（这是你明确要的），
> 周迭代等真的需要"承诺边界"再加。

---

## 7. 风险：你会不会用？（诚实评估）

这是本方案最大的风险，必须直说：

| 证据 | 推论 |
| --- | --- |
| `doing` 用了 0 / 69 | 你**不会**为了维护状态而维护状态 |
| 13 条同一天完成 | 你是**批量过一遍**，不是持续在列间移动 |

**所以这个方案的成败取决于一件事：阶段推进必须嵌入你已有的动作里，而不是新增一个动作。**

三个设计来保证这一点：

1. **Board 是默认视图** —— 打开就看到，不用切
2. **推进是一个按钮**，不是拖拽 —— 点一下的成本
3. **闸门可跳过**，只有"完成"要一句测试证据 —— 不制造摩擦

如果两周后卡片还是停在「需求」不动，那就说明**这个功能也不该做** ——
和上次一样，先跑一个最小验证再投入。

### 最小验证（1 天，不用改数据结构）

在你现有的 `TaskList` 里建五个清单：

```
需求 / 验证 / 开发 / 自测 / 完成
```

任务在清单之间"移动"（改 `task_list`），`completed_at` 自动打点。
跑两周，看你会不会真的移动。

**会 → 值得开发成正式阶段模型。不会 → 省下 4 天。**

---

## 8. 实施顺序

| 步骤 | 内容 | 估时 |
| --- | --- | --- |
| 1 | `Stage` 模型 + 建区时自动播种默认流水线 + 数据迁移 | 1 人日 |
| 2 | `Task.stage / stage_entered_at / is_blocked` + `status` 同步落库 + 批量操作补丁 | 1 人日 |
| 3 | API：`POST /tasks/{id}/advance/`、`/stage/` 过滤、`GET /analytics/flow/` | 1 人日 |
| 4 | Board 视图（含停留天数、WIP、⚠） | 1.5 人日 |
| 5 | 阶段闸门对话框（可跳过 + 完成强制一句证据） | 0.5 人日 |
| 6 | MCP：`get_tasks` 加 `stage` 过滤，`get_context` 带自测证据 | 0.5 人日 |
| 7 | 迁移验证 + E2E 补充 | 0.5 人日 |
| **合计** | | **6 人日** |

第 1–2 步做完就可以开始用（API 层），UI 可以晚一步。

---

## 9. 明确不做

| 不做 | 为什么 |
| --- | --- |
| ❌ 拖拽排序 | 移动端不可用；你本来就不维护状态，明确的按钮更可能被点 |
| ❌ 子任务独立流转 | 子任务是拆解手段，不是工作项。独立流转会让看板爆炸 |
| ❌ 自定义阶段颜色 | 全局黑白极简；阶段用**序号 + 名称**区分，够了 |
| ❌ 泳道 / 按人分组 | 单用户项目，没有"人"这个维度 |
| ❌ 累积流图（CFD） | 需要每天记录，你不会做 |
| ❌ 强制全部闸门 | 摩擦会杀死这个功能（`doing` 的教训） |
| ❌ 每个工作区从零配阶段 | 建区自动播种默认五阶段，想改再改 |

---

## 10. 一句话

> 把 `todo/doing/done` 换成 **需求 → 验证 → 开发 → 自测 → 完成**，
> 每张卡上显示**它在这一列待了几天**，
> 然后用这些天数算出**你的瓶颈在哪一段**。
>
> 看板是副产品，**阶段停留时间才是产品**。
