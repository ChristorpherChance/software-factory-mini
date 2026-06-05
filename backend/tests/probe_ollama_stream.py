"""探针：直连本地 Ollama，验证 OpenAI 兼容「流式」是否真的逐 token 到达。

用法（在 backend 目录下）：
    .venv/Scripts/python.exe -m tests.probe_ollama_stream [model] [base_url]
默认：model=deepseek-r1:14b  base_url=http://localhost:11434/v1

判读：
- 流式段数远大于 1、且时间戳逐步增长 → 真流式（后端没问题，问题在前端看错面板）。
- 抛异常 → 打印的 traceback / HTTP body 就是根因（模型名错、端口错、服务不支持 stream…）。
- 只收到 1 段、瞬间到达 → 该服务没按 SSE 增量返回（非我们代码问题）。
"""
import asyncio
import sys
import time
import traceback

from app.core.llm import _openai_chat_stream, _openai_chat

MODEL = sys.argv[1] if len(sys.argv) > 1 else "deepseek-r1:14b"
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:11434/v1"
SYS = "你是需求助手，回答尽量分成多句、多段。"
USER = "请分 5 句话，简述什么是敏捷开发。"


async def main():
    print(f"[probe] model={MODEL}  base_url={BASE}")
    print("[probe] ===== 流式 _openai_chat_stream =====")
    t0 = time.monotonic()
    n = 0
    try:
        async for chn, tok in _openai_chat_stream(SYS, USER, MODEL, BASE, None, temperature=0.3):
            n += 1
            print(f"  +{time.monotonic() - t0:6.2f}s | [{chn}] {tok!r}", flush=True)
        dt = time.monotonic() - t0
        print(f"[probe] 流式结束：{n} 段增量，用时 {dt:.2f}s")
        if n <= 1:
            print("[probe][!] 只收到 <=1 段 → 该端点未按 SSE 增量返回（非本项目代码问题）")
        else:
            print("[probe][OK] 真流式正常（含 reasoning 思考链）→ 在「对话面板」观察流式")
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        print(f"[probe][ERROR] 流式失败：{e!r}")
        print("[probe] ↑ 这就是后端回落到非流式的真实原因")

    print("[probe] ===== 非流式 _openai_chat（对照）=====")
    try:
        out = await _openai_chat(SYS, USER, MODEL, BASE, None)
        print(f"[probe] 非流式 OK，{len(out)} 字：{out[:100]!r}…")
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        print(f"[probe][ERROR] 非流式也失败：{e!r}（说明是连通/模型名问题，不止流式）")


if __name__ == "__main__":
    asyncio.run(main())
