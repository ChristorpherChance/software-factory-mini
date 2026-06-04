"""可观测埋点（T-ORC-05）。"""
import time
import logging
import contextlib

from .events import publish

log = logging.getLogger("factory")
_metrics: dict[str, list[float]] = {}


@contextlib.asynccontextmanager
async def span(name: str, pid: str | None = None, **attrs):
    t0 = time.time()
    log.info("span.start %s %s", name, attrs)
    try:
        yield
    finally:
        dt = (time.time() - t0) * 1000
        _metrics.setdefault(name, []).append(dt)
        log.info("span.end %s %.1fms", name, dt)
        if pid:
            with contextlib.suppress(Exception):
                await publish(pid, "task.update", {"task_id": name, "latency_ms": round(dt)})


def p95(name: str) -> float:
    xs = sorted(_metrics.get(name, []))
    return xs[int(len(xs) * 0.95)] if xs else 0.0


def metrics_snapshot() -> dict:
    return {
        name: {
            "count": len(xs),
            "p95_ms": round(p95(name), 1),
            "avg_ms": round(sum(xs) / len(xs), 1) if xs else 0.0,
        }
        for name, xs in _metrics.items()
    }
