"""重试/超时/升级策略（T-ORC-03）。"""
import asyncio
import random
from dataclasses import dataclass


@dataclass
class RetryPolicy:
    max_attempts: int = 3
    base_delay: float = 0.5
    timeout: float = 120.0
    backoff: float = 2.0


class EscalateToHitl(Exception):
    """超过重试预算 → 升级给人处理。"""


async def run_with_policy(coro_factory, policy: RetryPolicy = RetryPolicy()):
    last_err = None
    for attempt in range(1, policy.max_attempts + 1):
        try:
            return await asyncio.wait_for(coro_factory(), timeout=policy.timeout)
        except asyncio.TimeoutError as e:
            last_err = e
        except Exception as e:  # noqa: BLE001  业务错误也重试
            last_err = e
        delay = policy.base_delay * (policy.backoff ** (attempt - 1))
        await asyncio.sleep(delay + random.uniform(0, 0.2))
    raise EscalateToHitl(f"exhausted {policy.max_attempts} attempts: {last_err}")
