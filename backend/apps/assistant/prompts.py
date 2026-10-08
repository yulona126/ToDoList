"""Prompt construction.

**Token economy rules (docs/ai-assistant.md §2):**

* ``SYSTEM_PROMPT`` is byte-for-byte constant so DeepSeek's automatic context
  cache can hit on it. Never interpolate anything user-specific into it.
* Everything variable (list names, tag names, today's date, the user's text)
  goes into the *user* message.
* The model answers with 1-character keys to keep completion tokens down.
"""

from __future__ import annotations

import re

# --- the cacheable prefix ---------------------------------------------------
SYSTEM_PROMPT = """你是待办抽取器。把用户的一段话拆成任务，只输出 JSON。

格式：{"tasks":[{"t":"标题","l":"清单名","p":"low|medium|high|urgent","y":"dev|meeting|communication|design|research|other","d":"YYYY-MM-DD","g":["标签名"],"s":["子任务标题"]}]}

规则：
1 只输出 JSON，不要解释、不要 markdown 代码块。
2 t 必填，简洁的动宾短语，不超过 30 字。
3 没有依据的字段一律省略，不要猜。
4 l 只能取给定清单名之一；g 只能取给定标签名之一。
5 一句话包含多件事就拆成多条，最多 8 条。
6 s 仅在明显需要拆解时给出，最多 5 条，每条不超过 20 字。
7 d 只能是 YYYY-MM-DD，相对日期以「今天」为基准换算。

示例输入：
清单: 需求|开发
标签: api
今天: 2026-01-05
---
明天把登录接口的错误码统一一下，顺便让设计确认下按钮态
示例输出：
{"tasks":[{"t":"统一登录接口错误码","l":"开发","y":"dev","g":["api"],"d":"2026-01-06"},{"t":"确认按钮交互态","l":"需求","y":"design"}]}"""


#: Split prompt for the "break one task into sub-tasks" flow. Also constant.
SPLIT_SYSTEM_PROMPT = """你是任务拆解器。把一条任务拆成 3-5 条可执行的子任务，只输出 JSON。

格式：{"subtasks":[{"t":"子任务标题"}]}

规则：
1 只输出 JSON，不要解释、不要 markdown 代码块。
2 每条不超过 20 字，动词开头。
3 子任务之间不要重复、不要包含父任务本身。
4 无法拆解时返回 {"subtasks":[]}。"""


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def build_user_message(
    text: str,
    *,
    list_names: list[str],
    tag_names: list[str],
    today: str,
    max_tasks: int,
) -> str:
    """Compact, delimiter-separated context. No JSON, no ids, no existing tasks."""
    return (
        f"清单: {'|'.join(list_names) or '(无)'}\n"
        f"标签: {'|'.join(tag_names) or '(无)'}\n"
        f"今天: {today}\n"
        f"最多: {max_tasks} 条\n"
        f"---\n{text}"
    )


def strip_code_fence(content: str) -> str:
    """Models occasionally wrap JSON in a markdown fence despite instructions."""
    match = _FENCE_RE.search(content)
    return match.group(1) if match else content.strip()


def estimate_max_tokens(text_length: int) -> int:
    """Output ceiling. Deliberately generous.

    ``max_tokens`` is a **ceiling, not a cost** — you are billed only for what
    the model actually generates. Setting it too low is the worst of both
    worlds: the call is billed in full and the result is worthless.

    Measured against the real API with a 108-character Chinese note:

    ============  ==================  =====================
    max_tokens    finish_reason       content
    ============  ==================  =====================
    320           ``length``          *empty* (320 billed)
    1500          ``stop``            3 tasks in 283 tokens
    ============  ==================  =====================

    So the old "60 tokens per task" estimate was not just tight, it was 100%
    fatal: every call truncated and returned nothing.
    """
    estimated_tasks = max(1, min(8, text_length // 25 + 1))
    return max(900, min(2500, 500 + 250 * estimated_tasks))
