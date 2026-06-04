"""脱敏规则引擎（T-DLG-02）：敏感 key 整体遮蔽 + 字符串值正则清洗。"""
import re

RULES = [
    (re.compile(r"sk-[A-Za-z0-9]{16,}"), "[REDACTED_KEY]"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[REDACTED_EMAIL]"),
    (re.compile(r"\b(?:\d[ -]?){13,16}\b"), "[REDACTED_CARD]"),
    (re.compile(r"1[3-9]\d{9}"), "[REDACTED_PHONE]"),
]
DENY_KEYS = {"password", "secret", "token", "api_key", "apikey", "authorization"}


def _scrub_str(s: str) -> str:
    for pat, repl in RULES:
        s = pat.sub(repl, s)
    return s


def redact(obj):
    if isinstance(obj, dict):
        return {
            k: ("[REDACTED]" if k.lower() in DENY_KEYS else redact(v)) for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [redact(x) for x in obj]
    if isinstance(obj, str):
        return _scrub_str(obj)
    return obj
