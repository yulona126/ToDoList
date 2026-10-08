"""AI assistant tests.

**No test touches the network.** Every provider call is replaced by patching
``DeepSeekClient._post`` with a canned :class:`ChatResult`, so the suite is
deterministic and costs nothing.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from apps.assistant import crypto, local_parser
from apps.assistant.deepseek import AiError, ChatResult, validate_base_url
from apps.assistant.models import AiCredential, AiUsageRecord
from apps.assistant.services import normalize_drafts
from apps.todos.models import Tag, Task, TaskList, Workspace

User = get_user_model()

CREDENTIAL_URL = "/api/v1/ai/credential/"
TEST_URL = "/api/v1/ai/credential/test/"
PARSE_URL = "/api/v1/ai/parse/"
SPLIT_URL = "/api/v1/ai/split/"
USAGE_URL = "/api/v1/ai/usage/"
BULK_CREATE_URL = "/api/v1/tasks/bulk-create/"


def canned(payload: dict[str, Any], **overrides: Any) -> ChatResult:
    defaults: dict[str, Any] = {
        "prompt_tokens": 95,
        "completion_tokens": 110,
        "cached_tokens": 215,
        "total_tokens": 205,
        "latency_ms": 1840,
    }
    defaults.update(overrides)
    return ChatResult(payload=payload, **defaults)


# --------------------------------------------------------------------- units
class LocalParserTests(APITestCase):
    LISTS = [{"id": 1, "name": "开发"}, {"id": 2, "name": "需求梳理"}]

    def parse(self, text: str, today: date = date(2026, 10, 8)):
        return local_parser.parse(text, lists=self.LISTS, today=today)

    def test_markers_are_extracted(self) -> None:
        result = self.parse("写登录页 @开发 #api !高 /开发 明天")
        self.assertEqual(len(result.drafts), 1)
        draft = result.drafts[0]
        self.assertEqual(draft.t, "写登录页")
        self.assertEqual(draft.list_name, "开发")
        self.assertEqual(draft.tag_names, ["api"])
        self.assertEqual(draft.priority, "high")
        self.assertEqual(draft.task_type, "dev")
        self.assertEqual(draft.due_date, "2026-10-09")
        self.assertFalse(result.should_escalate)

    def test_plain_short_text_is_one_task(self) -> None:
        result = self.parse("写登录页")
        self.assertEqual(len(result.drafts), 1)
        self.assertEqual(result.drafts[0].t, "写登录页")
        self.assertFalse(result.should_escalate)

    def test_connector_escalates(self) -> None:
        result = self.parse("下周三前和设计对一下登录流程")
        self.assertTrue(result.should_escalate)

    def test_long_text_escalates(self) -> None:
        self.assertTrue(self.parse("x" * 41).should_escalate)
        self.assertFalse(self.parse("x" * 40).should_escalate)

    def test_three_lines_escalate(self) -> None:
        self.assertTrue(self.parse("a\nb\nc").should_escalate)

    def test_caret_forces_title_and_blocks_escalation(self) -> None:
        text = "^和设计确认按钮态，另外同步给后端"
        result = self.parse(text)
        self.assertFalse(result.should_escalate)
        self.assertEqual(result.drafts[0].t, "和设计确认按钮态，另外同步给后端")

    def test_unknown_list_warns_and_falls_back(self) -> None:
        result = self.parse("改接口 @前端")
        self.assertEqual(result.drafts[0].t, "改接口")
        self.assertIsNone(result.drafts[0].list_name)
        self.assertEqual(len(result.warnings), 1)
        self.assertIn("前端", result.warnings[0])

    def test_relative_dates(self) -> None:
        today = date(2026, 10, 8)  # a Thursday
        cases = {
            "今天": "2026-10-08",
            "明天": "2026-10-09",
            "后天": "2026-10-10",
            "大后天": "2026-10-11",
            "周一": "2026-10-12",
            "周四": "2026-10-08",  # today is Thursday
            "下周四": "2026-10-15",
            "10-20": "2026-10-20",
            "2026-12-01": "2026-12-01",
        }
        for word, expected in cases.items():
            with self.subTest(word=word):
                result = self.parse(f"做点事 {word}", today=today)
                self.assertEqual(result.drafts[0].due_date, expected)

    def test_marker_only_line_creates_nothing(self) -> None:
        result = self.parse("@开发 #api")
        self.assertEqual(result.drafts, [])

    def test_priority_and_type_synonyms(self) -> None:
        result = self.parse("上线 !urgent /meeting")
        self.assertEqual(result.drafts[0].priority, "urgent")
        self.assertEqual(result.drafts[0].task_type, "meeting")

    def test_unknown_marker_token_stays_in_title(self) -> None:
        result = self.parse("同步 !nope 进度")
        self.assertEqual(result.drafts[0].t, "同步 !nope 进度")
        self.assertIsNone(result.drafts[0].priority)

    def test_next_week_weekday_counts_from_monday(self) -> None:
        """Regression: `下周三` from a Thursday is next week, not the week after.

        The naive "next occurrence + 7 days" rule overshoots whenever the
        requested weekday has already passed in the current week. The frontend
        parser (``src/lib/localParse.ts``) counts from Monday; the two must
        agree or the instant preview promises a date the server won't store.
        """
        # 2026-10-08 is a Thursday.
        today = date(2026, 10, 8)
        cases = {
            "下周一": "2026-10-12",
            "下周二": "2026-10-13",
            "下周三": "2026-10-14",
            "下周四": "2026-10-15",
            "下周五": "2026-10-16",
            "下周六": "2026-10-17",
            "下周日": "2026-10-18",
            "下下周三": "2026-10-21",
            "下周": "2026-10-12",  # bare form: Monday of next week
        }
        for word, expected in cases.items():
            with self.subTest(word=word):
                result = self.parse(f"做点事 {word}", today=today)
                self.assertEqual(result.drafts[0].due_date, expected)

    def test_this_week_weekday_rolls_forward(self) -> None:
        today = date(2026, 10, 8)  # Thursday
        self.assertEqual(self.parse("做点事 周三", today).drafts[0].due_date, "2026-10-14")
        self.assertEqual(self.parse("做点事 周四", today).drafts[0].due_date, "2026-10-08")
        self.assertEqual(self.parse("做点事 周六", today).drafts[0].due_date, "2026-10-10")

    def test_multi_line_creates_multiple_drafts(self) -> None:
        result = self.parse("写文档 @开发\n跑测试 @开发")
        self.assertEqual(len(result.drafts), 2)

    def test_caps_at_max_tasks(self) -> None:
        result = local_parser.parse(
            "\n".join(f"任务{i}" for i in range(20)),
            lists=self.LISTS,
            today=date(2026, 10, 8),
            max_tasks=8,
        )
        self.assertEqual(len(result.drafts), 8)


class CryptoTests(APITestCase):
    def test_round_trip(self) -> None:
        token = crypto.encrypt("sk-secret-value")
        self.assertNotIn(b"sk-secret-value", token)
        self.assertEqual(crypto.decrypt(token), "sk-secret-value")

    def test_mask_never_leaks_the_middle(self) -> None:
        masked = crypto.mask("sk-1234567890abcdef")
        self.assertEqual(masked, "sk-1234****cdef")
        self.assertNotIn("567890", masked)

    def test_mask_handles_short_keys(self) -> None:
        self.assertEqual(crypto.mask("abc"), "abc****")

    def test_decrypt_raises_after_key_rotation(self) -> None:
        token = crypto.encrypt("sk-value")
        with override_settings(SECRET_KEY="a-completely-different-secret"):
            with self.assertRaises(crypto.CredentialDecryptionError):
                crypto.decrypt(token)


class BaseUrlValidationTests(APITestCase):
    def test_accepts_https(self) -> None:
        self.assertEqual(
            validate_base_url("https://api.deepseek.com"), "https://api.deepseek.com"
        )

    def test_rejects_http(self) -> None:
        with self.assertRaises(AiError):
            validate_base_url("http://api.deepseek.com")

    def test_rejects_localhost_and_private_ranges(self) -> None:
        for url in (
            "https://localhost/v1",
            "https://127.0.0.1/v1",
            "https://10.0.0.5/v1",
            "https://192.168.1.10/v1",
        ):
            with self.subTest(url=url), self.assertRaises(AiError):
                validate_base_url(url)


# --------------------------------------------------------------- API: creds
class CredentialApiTests(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="ai@example.com", username="ai", password="SuperSecret123"
        )
        self.client.force_authenticate(self.user)

    def test_get_without_credential(self) -> None:
        response = self.client.get(CREDENTIAL_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["configured"])
        self.assertIn("deepseek-flash", response.data["models_available"])

    def test_put_creates_and_never_returns_the_key(self) -> None:
        response = self.client.put(
            CREDENTIAL_URL,
            {"api_key": "sk-abcdefghijklmnop", "model": "deepseek-flash"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertTrue(response.data["configured"])
        self.assertEqual(response.data["key_mask"], "sk-abcd****mnop")
        self.assertNotIn("sk-abcdefghijklmnop", str(response.data))

        credential = AiCredential.objects.get(user=self.user)
        self.assertEqual(credential.get_api_key(), "sk-abcdefghijklmnop")
        # The raw key must not be recoverable from the column.
        self.assertNotIn(b"sk-abcdefghijklmnop", bytes(credential.api_key_encrypted))

    def test_put_without_key_on_new_credential_is_rejected(self) -> None:
        response = self.client.put(CREDENTIAL_URL, {"model": "deepseek-chat"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("api_key", response.data["errors"])

    def test_put_without_key_keeps_the_existing_one(self) -> None:
        self.client.put(CREDENTIAL_URL, {"api_key": "sk-originalvalue1"}, format="json")
        response = self.client.put(CREDENTIAL_URL, {"model": "deepseek-chat"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(AiCredential.objects.get(user=self.user).get_api_key(), "sk-originalvalue1")
        self.assertEqual(response.data["model"], "deepseek-chat")

    def test_put_rejects_insecure_base_url(self) -> None:
        response = self.client.put(
            CREDENTIAL_URL,
            {"api_key": "sk-abcdefghijklmnop", "base_url": "http://localhost:8080"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("base_url", response.data["errors"])

    def test_delete(self) -> None:
        self.client.put(CREDENTIAL_URL, {"api_key": "sk-abcdefghijklmnop"}, format="json")
        response = self.client.delete(CREDENTIAL_URL)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(AiCredential.objects.filter(user=self.user).exists())

    def test_requires_authentication(self) -> None:
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(CREDENTIAL_URL).status_code, status.HTTP_401_UNAUTHORIZED)


# ------------------------------------------------------- API: parse (local)
class LocalParseApiTests(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="ai@example.com", username="ai", password="SuperSecret123"
        )
        self.client.force_authenticate(self.user)
        self.workspace = Workspace.objects.create(name="W", owner=self.user)
        self.task_list = TaskList.objects.create(workspace=self.workspace, name="开发")

    def test_local_parse_needs_no_credential(self) -> None:
        response = self.client.post(
            PARSE_URL,
            {"workspace": self.workspace.id, "text": "写登录页 @开发 #api !高"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["source"], "local")
        self.assertEqual(response.data["usage"]["total_tokens"], 0)

        draft = response.data["tasks"][0]
        self.assertEqual(draft["t"], "写登录页")
        self.assertEqual(draft["l"], self.task_list.id)
        self.assertEqual(draft["p"], "high")
        self.assertEqual(draft["g_names"], ["api"])
        self.assertEqual(draft["g"], [])  # unknown tag: created on confirm, not here

    def test_local_parse_records_a_local_usage_row(self) -> None:
        self.client.post(
            PARSE_URL, {"workspace": self.workspace.id, "text": "写文档"}, format="json"
        )
        record = AiUsageRecord.objects.get(user=self.user)
        self.assertEqual(record.source, AiUsageRecord.Source.LOCAL)
        self.assertEqual(record.total_tokens, 0)

    def test_local_parse_resolves_existing_tag_id(self) -> None:
        tag = Tag.objects.create(workspace=self.workspace, name="api")
        response = self.client.post(
            PARSE_URL,
            {"workspace": self.workspace.id, "text": "写登录页 #api"},
            format="json",
        )
        self.assertEqual(response.data["tasks"][0]["g"], [tag.id])

    def test_ai_mode_without_credential_returns_400(self) -> None:
        response = self.client.post(
            PARSE_URL,
            {"workspace": self.workspace.id, "text": "随便一段话", "mode": "ai"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("尚未配置", response.data["detail"])

    def test_foreign_workspace_is_rejected(self) -> None:
        other = User.objects.create_user(
            email="other@example.com", username="other", password="SuperSecret123"
        )
        theirs = Workspace.objects.create(name="T", owner=other)
        response = self.client.post(
            PARSE_URL, {"workspace": theirs.id, "text": "写文档"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_blank_text_is_rejected(self) -> None:
        response = self.client.post(
            PARSE_URL, {"workspace": self.workspace.id, "text": "   "}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


# ------------------------------------------------ API: explicit mode contract
class ExplicitModeTests(APITestCase):
    """Whether a model is used is the caller's decision, not a heuristic.

    Regression for a real report: prose with no markers produced zero tasks,
    because an `auto` heuristic escalated to a model that was not configured.
    The contract is now binary and explicit:

    * `mode=local` (default) — markers only. Never calls a model, never guesses.
    * `mode=ai`              — always hands the text to the model.
    """

    #: The exact text that triggered the report.
    PROSE = (
        "下周2howto text会, real time 和 playback 显示的roi 都要显示， "
        "只是可以手动隐藏一些roi (需要等下周joy整合完), 接入library页面, "
        "跳转需要到新library页面"
    )

    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="fb@example.com", username="fb", password="SuperSecret123"
        )
        self.client.force_authenticate(self.user)
        self.workspace = Workspace.objects.create(name="W", owner=self.user)
        TaskList.objects.create(workspace=self.workspace, name="开发")
        # Deliberately NO AiCredential.

    def parse(self, text: str, mode: str | None = None):
        payload = {"workspace": self.workspace.id, "text": text}
        if mode is not None:
            payload["mode"] = mode
        return self.client.post(PARSE_URL, payload, format="json")

    # -- local ---------------------------------------------------------------
    def test_local_is_the_default(self) -> None:
        response = self.parse("写登录页 @开发 !高")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["source"], "local")
        self.assertEqual(response.data["usage"]["total_tokens"], 0)

    def test_local_never_escalates_on_prose(self) -> None:
        """No markers means one task — even when that task is a whole paragraph.

        That is the documented contract, not a failure: the user did not ask
        for AI, so the rules do not invent structure.
        """
        response = self.parse(self.PROSE, mode="local")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["source"], "local")
        self.assertEqual(len(response.data["tasks"]), 1)
        self.assertEqual(response.data["usage"]["total_tokens"], 0)

    def test_local_makes_no_ai_call_and_records_nothing_billable(self) -> None:
        self.parse(self.PROSE, mode="local")
        record = AiUsageRecord.objects.get(user=self.user)
        self.assertEqual(record.source, AiUsageRecord.Source.LOCAL)
        self.assertEqual(record.total_tokens, 0)

    def test_local_works_without_any_credential(self) -> None:
        self.assertEqual(self.parse("随手记一条", mode="local").status_code, 200)

    def test_auto_mode_is_gone(self) -> None:
        self.assertEqual(self.parse(self.PROSE, mode="auto").status_code, 400)

    # -- ai ------------------------------------------------------------------
    def test_ai_always_requires_a_credential_even_for_marked_text(self) -> None:
        """Clicking "AI analyse" must really go to the model, so it must fail
        loudly when there is no key — not silently fall back to the rules."""
        for text in (self.PROSE, "写登录页 @开发 !高"):
            with self.subTest(text=text[:20]):
                response = self.parse(text, mode="ai")
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertIn("尚未配置", response.data["detail"])

    def test_ai_never_falls_back_to_local(self) -> None:
        self.parse(self.PROSE, mode="ai")
        self.assertFalse(
            AiUsageRecord.objects.filter(source=AiUsageRecord.Source.LOCAL).exists()
        )


# ---------------------------------------------------------- API: parse (AI)
class AiParseApiTests(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="ai@example.com", username="ai", password="SuperSecret123"
        )
        self.client.force_authenticate(self.user)
        self.workspace = Workspace.objects.create(name="W", owner=self.user)
        self.task_list = TaskList.objects.create(workspace=self.workspace, name="开发")
        Tag.objects.create(workspace=self.workspace, name="api")

        self.credential = AiCredential(user=self.user, model="deepseek-flash")
        self.credential.set_api_key("sk-test-key-1234567890")
        self.credential.save()

    def _patch(self, result: ChatResult | Exception, captured: dict[str, Any] | None = None):
        from apps.assistant import deepseek

        # Bind the original in the closure: it is restored LIFO, and a
        # late-bound `self._original` would restore an already-patched function
        # when _patch is called more than once in a test.
        original = deepseek.DeepSeekClient._post

        def fake_post(_self, body):  # noqa: ANN001
            if captured is not None:
                captured["body"] = body
            if isinstance(result, Exception):
                raise result
            return result

        deepseek.DeepSeekClient._post = fake_post
        self.addCleanup(lambda: setattr(deepseek.DeepSeekClient, "_post", original))

    def _parse(self, text: str, **extra: Any):
        return self.client.post(
            PARSE_URL,
            {"workspace": self.workspace.id, "text": text, "mode": "ai", **extra},
            format="json",
        )

    def test_ai_parse_maps_names_to_ids(self) -> None:
        self._patch(
            canned(
                {
                    "tasks": [
                        {"t": "统一错误码", "l": "开发", "p": "high", "y": "dev",
                         "d": "2026-10-20", "g": ["api"], "s": ["列出现有码", "定规范"]}
                    ]
                }
            )
        )
        response = self._parse("随便一段自然语言描述")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["source"], "ai")

        draft = response.data["tasks"][0]
        self.assertEqual(draft["t"], "统一错误码")
        self.assertEqual(draft["l"], self.task_list.id)
        self.assertEqual(draft["l_name"], "开发")
        self.assertEqual(draft["p"], "high")
        self.assertEqual(draft["d"], "2026-10-20")
        self.assertEqual(len(draft["g"]), 1)
        self.assertEqual(draft["s"], ["列出现有码", "定规范"])

        self.assertEqual(response.data["usage"]["total_tokens"], 205)
        self.assertEqual(response.data["usage"]["cached_tokens"], 215)

        record = AiUsageRecord.objects.filter(source=AiUsageRecord.Source.AI).first()
        self.assertEqual(record.total_tokens, 205)
        self.assertEqual(record.model, "deepseek-flash")

    def test_unknown_list_warns_and_uses_inbox(self) -> None:
        self._patch(canned({"tasks": [{"t": "做点事", "l": "不存在的清单"}]}))
        response = self._parse("随便一段自然语言描述")
        self.assertIsNone(response.data["tasks"][0]["l"])
        codes = [w["code"] for w in response.data["warnings"]]
        self.assertIn("list_not_found", codes)

    def test_invalid_enum_and_date_are_dropped(self) -> None:
        self._patch(
            canned({"tasks": [{"t": "做点事", "p": "SUPER", "y": "nope", "d": "下周三"}]})
        )
        response = self._parse("随便一段自然语言描述")
        draft = response.data["tasks"][0]
        self.assertIsNone(draft["p"])
        self.assertIsNone(draft["y"])
        self.assertIsNone(draft["d"])
        self.assertIn("bad_date", [w["code"] for w in response.data["warnings"]])

    def test_blank_titles_are_skipped(self) -> None:
        self._patch(canned({"tasks": [{"t": "  "}, {"t": "有效任务"}]}))
        response = self._parse("随便一段自然语言描述")
        self.assertEqual(len(response.data["tasks"]), 1)
        self.assertIn("empty_title", [w["code"] for w in response.data["warnings"]])

    def test_results_are_truncated_to_eight(self) -> None:
        self._patch(canned({"tasks": [{"t": f"任务{i}"} for i in range(20)]}))
        response = self._parse("随便一段自然语言描述")
        self.assertEqual(len(response.data["tasks"]), 8)
        self.assertIn("truncated", [w["code"] for w in response.data["warnings"]])

    def test_non_list_payload_is_handled(self) -> None:
        self._patch(canned({"tasks": "oops"}))
        response = self._parse("随便一段自然语言描述")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["tasks"], [])
        self.assertIn("bad_payload", [w["code"] for w in response.data["warnings"]])

    def test_empty_payload_yields_a_friendly_warning(self) -> None:
        self._patch(canned({}))
        response = self._parse("随便一段自然语言描述")
        self.assertEqual(response.data["tasks"], [])
        self.assertIn("no_tasks", [w["code"] for w in response.data["warnings"]])

    def test_prompt_is_compact_and_cache_friendly(self) -> None:
        """T2/T4: the system prompt must be byte-identical across requests.

        Identical prefix ⇒ the provider's context cache can hit, which is the
        single largest token saving. Anything request-specific has to live in
        the user message.
        """
        captured_a: dict[str, Any] = {}
        self._patch(canned({"tasks": [{"t": "任务"}]}), captured_a)
        self._parse("随便一段自然语言描述")

        # Different vocabulary and different text for the second call.
        TaskList.objects.create(workspace=self.workspace, name="运维")
        captured_b: dict[str, Any] = {}
        self._patch(canned({"tasks": [{"t": "任务"}]}), captured_b)
        self._parse("完全不同的另一段文字")

        body_a, body_b = captured_a["body"], captured_b["body"]
        system_a, user_a = body_a["messages"][0]["content"], body_a["messages"][1]["content"]
        system_b, user_b = body_b["messages"][0]["content"], body_b["messages"][1]["content"]

        self.assertEqual(system_a, system_b, "system prompt must never vary")
        self.assertNotEqual(user_a, user_b, "variable context belongs in the user message")
        self.assertEqual(body_a["messages"][0]["role"], "system")

        # T4: names only, never numeric ids.
        self.assertIn("清单: 开发", user_a)
        self.assertIn("标签: api", user_a)
        self.assertNotIn(str(self.task_list.id), user_a)
        self.assertIn("运维", user_b)

        # T6/T7: deterministic sampling and a hard output cap.
        self.assertEqual(body_a["temperature"], 0)
        self.assertEqual(body_a["response_format"], {"type": "json_object"})
        self.assertLessEqual(body_a["max_tokens"], 400)
        self.assertFalse(body_a["stream"])

    def test_upstream_error_becomes_502_and_is_recorded(self) -> None:
        self._patch(AiError("API Key 无效或已被撤销（401）。"))
        response = self._parse("随便一段自然语言描述")
        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertIn("401", response.data["detail"])
        self.assertTrue(
            AiUsageRecord.objects.filter(user=self.user, ok=False).exists()
        )
        self.credential.refresh_from_db()
        self.assertIn("401", self.credential.last_error)

    def test_quota_exhaustion_returns_429(self) -> None:
        AiUsageRecord.objects.create(
            user=self.user,
            kind=AiUsageRecord.Kind.PARSE,
            source=AiUsageRecord.Source.AI,
            total_tokens=99_999,
        )
        response = self._parse("随便一段自然语言描述")
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIn("配额", response.data["detail"])

    def test_inactive_credential_is_rejected(self) -> None:
        self.credential.is_active = False
        self.credential.save(update_fields=["is_active"])
        response = self._parse("随便一段自然语言描述")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


# --------------------------------------------------------- API: credential test
class CredentialTestApiTests(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="ai@example.com", username="ai", password="SuperSecret123"
        )
        self.client.force_authenticate(self.user)

    def test_requires_a_credential(self) -> None:
        self.assertEqual(
            self.client.post(TEST_URL).status_code, status.HTTP_400_BAD_REQUEST
        )

    def test_success_updates_last_verified(self) -> None:
        self.client.put(
            CREDENTIAL_URL, {"api_key": "sk-abcdefghijklmnop"}, format="json"
        )
        from apps.assistant import deepseek

        original = deepseek.DeepSeekClient._post
        deepseek.DeepSeekClient._post = lambda _self, _body: canned({}, latency_ms=42)
        self.addCleanup(lambda: setattr(deepseek.DeepSeekClient, "_post", original))

        response = self.client.post(TEST_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertTrue(response.data["ok"])
        self.assertEqual(response.data["latency_ms"], 42)

        credential = AiCredential.objects.get(user=self.user)
        self.assertIsNotNone(credential.last_verified_at)
        self.assertEqual(credential.last_error, "")


# --------------------------------------------------------------- API: split
class SplitApiTests(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="ai@example.com", username="ai", password="SuperSecret123"
        )
        self.client.force_authenticate(self.user)
        self.workspace = Workspace.objects.create(name="W", owner=self.user)
        self.task = Task.objects.create(workspace=self.workspace, title="实现登录")
        self.credential = AiCredential(user=self.user, model="deepseek-flash")
        self.credential.set_api_key("sk-test-key-1234567890")
        self.credential.save()

    def _patch(self, result: ChatResult | Exception):
        from apps.assistant import deepseek

        original = deepseek.DeepSeekClient._post

        def fake_post(_self, _body):  # noqa: ANN001
            if isinstance(result, Exception):
                raise result
            return result

        deepseek.DeepSeekClient._post = fake_post
        self.addCleanup(lambda: setattr(deepseek.DeepSeekClient, "_post", original))

    def test_split_returns_subtasks(self) -> None:
        self._patch(canned({"subtasks": [{"t": "画时序图"}, {"t": "写接口"}, {"t": "补测试"}]}))
        response = self.client.post(SPLIT_URL, {"task_id": self.task.id}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(
            [s["t"] for s in response.data["subtasks"]], ["画时序图", "写接口", "补测试"]
        )

    def test_split_filters_the_parent_title_and_duplicates(self) -> None:
        self._patch(canned({"subtasks": ["实现登录", "写接口", "写接口", ""]}))
        response = self.client.post(SPLIT_URL, {"task_id": self.task.id}, format="json")
        self.assertEqual([s["t"] for s in response.data["subtasks"]], ["写接口"])

    def test_split_rejects_task_that_already_has_subtasks(self) -> None:
        Task.objects.create(workspace=self.workspace, title="子", parent=self.task)
        response = self.client.post(SPLIT_URL, {"task_id": self.task.id}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_split_is_isolated(self) -> None:
        other = User.objects.create_user(
            email="o@example.com", username="o", password="SuperSecret123"
        )
        theirs = Workspace.objects.create(name="T", owner=other)
        foreign = Task.objects.create(workspace=theirs, title="secret")
        response = self.client.post(SPLIT_URL, {"task_id": foreign.id}, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


# --------------------------------------------------------- API: bulk create
class BulkCreateApiTests(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="ai@example.com", username="ai", password="SuperSecret123"
        )
        self.client.force_authenticate(self.user)
        self.workspace = Workspace.objects.create(name="W", owner=self.user)
        self.task_list = TaskList.objects.create(workspace=self.workspace, name="开发")

    def test_creates_tasks_with_tags_and_subtasks(self) -> None:
        response = self.client.post(
            BULK_CREATE_URL,
            {
                "tasks": [
                    {
                        "workspace": self.workspace.id,
                        "task_list": self.task_list.id,
                        "title": "统一错误码",
                        "priority": "high",
                        "task_type": "dev",
                        "due_date": "2026-10-20",
                        "tag_names": ["api", "新建的标签"],
                        "subtasks": ["列出现有码", "定规范"],
                    },
                    {"workspace": self.workspace.id, "title": "写文档"},
                ]
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["created"], 2)

        parent = Task.objects.get(title="统一错误码")
        self.assertEqual(parent.priority, "high")
        self.assertEqual(parent.due_date.isoformat(), "2026-10-20")
        self.assertEqual(parent.subtasks.count(), 2)
        self.assertEqual(
            sorted(parent.tags.values_list("name", flat=True)), ["api", "新建的标签"]
        )
        # A tag referenced by name only is created, matching manual entry.
        self.assertTrue(Tag.objects.filter(workspace=self.workspace, name="新建的标签").exists())

    def test_rejects_empty_list(self) -> None:
        response = self.client.post(BULK_CREATE_URL, {"tasks": []}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_rejects_missing_workspace_and_title(self) -> None:
        for payload in (
            {"tasks": [{"title": "x"}]},
            {"tasks": [{"workspace": self.workspace.id, "title": "  "}]},
        ):
            with self.subTest(payload=payload):
                response = self.client.post(BULK_CREATE_URL, payload, format="json")
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_rejects_foreign_workspace(self) -> None:
        other = User.objects.create_user(
            email="o@example.com", username="o", password="SuperSecret123"
        )
        theirs = Workspace.objects.create(name="T", owner=other)
        response = self.client.post(
            BULK_CREATE_URL,
            {"tasks": [{"workspace": theirs.id, "title": "hack"}]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Task.objects.filter(workspace=theirs).exists())

    def test_requires_authentication(self) -> None:
        self.client.force_authenticate(None)
        response = self.client.post(
            BULK_CREATE_URL, {"tasks": [{"workspace": 1, "title": "x"}]}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


# --------------------------------------------------------------- API: usage
class UsageApiTests(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="ai@example.com", username="ai", password="SuperSecret123"
        )
        self.client.force_authenticate(self.user)

    def test_usage_summary_computes_local_ratio(self) -> None:
        AiUsageRecord.objects.create(
            user=self.user, kind="parse", source="ai", total_tokens=400,
            prompt_tokens=200, completion_tokens=200, cached_tokens=150,
        )
        AiUsageRecord.objects.create(user=self.user, kind="parse", source="local")

        response = self.client.get(USAGE_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["ai_calls"], 1)
        self.assertEqual(response.data["local_calls"], 1)
        self.assertEqual(response.data["local_ratio"], 0.5)
        self.assertEqual(response.data["tokens"]["total_tokens"], 400)
        self.assertEqual(response.data["tokens"]["cached_tokens"], 150)
        self.assertEqual(len(response.data["recent"]), 2)

    def test_usage_is_isolated_per_user(self) -> None:
        other = User.objects.create_user(
            email="o@example.com", username="o", password="SuperSecret123"
        )
        AiUsageRecord.objects.create(user=other, kind="parse", source="ai", total_tokens=999)
        response = self.client.get(USAGE_URL)
        self.assertEqual(response.data["tokens"]["total_tokens"], 0)

    def test_days_parameter_is_clamped(self) -> None:
        response = self.client.get(f"{USAGE_URL}?days=99999")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["days"], 365)


# ----------------------------------------------------------- normalization
class NormalizeDraftsTests(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="ai@example.com", username="ai", password="SuperSecret123"
        )
        self.workspace = Workspace.objects.create(name="W", owner=self.user)
        self.task_list = TaskList.objects.create(workspace=self.workspace, name="开发")

    def test_long_title_is_truncated(self) -> None:
        drafts, _ = normalize_drafts(self.workspace, [{"t": "x" * 500}])
        self.assertEqual(len(drafts[0]["t"]), 200)

    def test_datetime_due_is_reduced_to_a_date(self) -> None:
        drafts, _ = normalize_drafts(
            self.workspace, [{"t": "a", "d": "2026-10-20T00:00:00Z"}]
        )
        self.assertEqual(drafts[0]["d"], "2026-10-20")

    def test_alternative_key_names_are_accepted(self) -> None:
        drafts, _ = normalize_drafts(
            self.workspace,
            [{"title": "a", "list": "开发", "priority": "low", "subtasks": ["s1"]}],
        )
        self.assertEqual(drafts[0]["t"], "a")
        self.assertEqual(drafts[0]["l"], self.task_list.id)
        self.assertEqual(drafts[0]["p"], "low")
        self.assertEqual(drafts[0]["s"], ["s1"])

    def test_default_list_is_used_when_model_omits_it(self) -> None:
        drafts, _ = normalize_drafts(
            self.workspace, [{"t": "a"}], default_list_id=self.task_list.id
        )
        self.assertEqual(drafts[0]["l"], self.task_list.id)
        self.assertEqual(drafts[0]["l_name"], "开发")

    def test_non_dict_entries_are_ignored(self) -> None:
        drafts, _ = normalize_drafts(self.workspace, ["nope", 42, {"t": "ok"}])
        self.assertEqual([d["t"] for d in drafts], ["ok"])


# ------------------------------------------------------------------- quota
class QuotaTests(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="ai@example.com", username="ai", password="SuperSecret123"
        )

    def test_tokens_used_today_ignores_local_and_old_rows(self) -> None:
        from apps.assistant.services import tokens_used_today

        AiUsageRecord.objects.create(user=self.user, kind="parse", source="ai", total_tokens=100)
        AiUsageRecord.objects.create(user=self.user, kind="parse", source="local")

        stale = AiUsageRecord.objects.create(
            user=self.user, kind="parse", source="ai", total_tokens=500
        )
        # created_at is auto_now_add, so push it back via a queryset update.
        AiUsageRecord.objects.filter(pk=stale.pk).update(
            created_at=AiUsageRecord.objects.get(pk=stale.pk).created_at - timedelta(days=2)
        )

        self.assertEqual(tokens_used_today(self.user), 100)

    @override_settings(AI_DAILY_TOKEN_BUDGET=0)
    def test_zero_budget_means_unlimited(self) -> None:
        from apps.assistant.services import enforce_quota, quota_remaining

        AiUsageRecord.objects.create(user=self.user, kind="parse", source="ai", total_tokens=10**6)
        enforce_quota(self.user)  # must not raise
        self.assertEqual(quota_remaining(self.user), -1)
