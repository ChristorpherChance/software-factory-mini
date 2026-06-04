"""POC-2 · 委派最小环路：发起→脱敏→降级→回流。"""
import asyncio

from app.delegate.fallback import with_fallback
from app.delegate.redact import redact


async def main():
    # 1) 脱敏验证
    dirty = {"prompt": "联系 a@b.com key sk-ABCDEFGHIJKLMNOP", "password": "x"}
    clean = redact(dirty)
    assert "sk-" not in clean["prompt"], clean
    assert "a@b.com" not in clean["prompt"], clean
    assert clean["password"] == "[REDACTED]", clean

    # 2) pi_subsession 本地不可用 → 降级到 generic_http(mock)，环路不崩
    res = await with_fallback("pi_subsession", {"prompt": "hello", "session_id": "s1"})
    assert "text" in res, res
    print(f"[POC-2] delegate -> {res['text'][:60]}")
    print("POC-2 PASS ✅ 委派发起→脱敏→降级→回流闭环")


if __name__ == "__main__":
    asyncio.run(main())
