"""本地 Claude CLI 子进程委派适配器（T-DLG-04）。"""
import asyncio
import json

from .base import DelegateTarget


class ClaudeCodeTarget(DelegateTarget):
    name = "claude_code"

    async def invoke(self, payload: dict) -> dict:
        proc = await asyncio.create_subprocess_exec(
            "claude",
            "-p",
            payload["prompt"],
            "--output-format",
            "json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=payload.get("cwd", "."),
        )
        out, err = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"claude_code exit {proc.returncode}: {err.decode()[:200]}")
        data = json.loads(out.decode())
        return {"text": data.get("result", ""), "raw": data}
