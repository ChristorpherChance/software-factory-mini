"""Task DAG 调度（T-ORC-02）：拓扑分层，同层并发。"""
import asyncio
from collections import defaultdict, deque

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models.entities import Task
from ...core.events import publish


class DagScheduler:
    def __init__(self, db: AsyncSession, runner):
        self.db = db
        self.runner = runner  # async (task) -> status

    def _toposort(self, tasks: list[Task], deps: dict[str, list[str]]):
        indeg = {t.code: 0 for t in tasks}
        adj = defaultdict(list)
        for code, ds in deps.items():
            for d in ds:
                if d in indeg and code in indeg:
                    adj[d].append(code)
                    indeg[code] += 1
        q = deque([c for c, d in indeg.items() if d == 0])
        layers = []
        seen = 0
        while q:
            layer = list(q)
            q.clear()
            for code in layer:
                seen += 1
                for nxt in adj[code]:
                    indeg[nxt] -= 1
                    if indeg[nxt] == 0:
                        q.append(nxt)
            layers.append(layer)
        if seen != len(indeg):
            raise ValueError("DAG has a cycle")
        return layers

    async def run(self, pid: str, deps: dict[str, list[str]]):
        tasks = (
            await self.db.execute(select(Task).where(Task.project_id == pid))
        ).scalars().all()
        by_code = {t.code: t for t in tasks if t.code}
        results = {}
        for layer in self._toposort([t for t in tasks if t.code], deps):
            done = await asyncio.gather(
                *(self._exec(by_code[c], pid) for c in layer if c in by_code)
            )
            for c, st in zip([c for c in layer if c in by_code], done):
                results[c] = st
        return results

    async def _exec(self, task: Task, pid: str) -> str:
        task.status = "in_progress"
        await self.db.commit()
        await publish(pid, "task.update", {"task_id": str(task.id), "status": "in_progress"})
        status = await self.runner(task)
        task.status = status
        await self.db.commit()
        await publish(pid, "task.update", {"task_id": str(task.id), "status": status})
        return status
