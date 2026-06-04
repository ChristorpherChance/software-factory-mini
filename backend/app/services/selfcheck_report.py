"""自检报告工件（T-SC-02 · M3 §2）。"""
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from ..models.entities import Artifact, ArtifactVersion
from ..core.events import publish
from .triple_check import run_triple_check


def _render_md(pid: str, result: dict) -> str:
    lines = [
        "# 需求三件套自检报告",
        f"- 项目：{pid}",
        f"- 时间：{datetime.now(timezone.utc).isoformat()}",
        f"- 总体：{'✅ 全绿' if result['allGreen'] else '❌ 有阻塞项'}",
        "",
    ]
    for c in result["checks"]:
        mark = "✅" if c["pass"] else "❌"
        lines.append(f"## {mark} {c['name']}")
        if c["name"] == "completeness" and c.get("missing"):
            lines.append("缺失：" + ", ".join(c["missing"]))
        if c["name"] == "consistency" and c.get("orphans"):
            lines.append("断点：" + ", ".join(c["orphans"]))
        if c["name"] == "testability":
            lines.append(f"覆盖率 {c['coverage']:.2f} / 门限 {c['gate']}")
        lines.append("")
    return "\n".join(lines)


async def generate_report(db: AsyncSession, pid: str, session_id: str) -> dict:
    result = await run_triple_check(db, pid)
    md = _render_md(pid, result)
    art = Artifact(project_id=pid, type="selfcheck_report", title="需求自检报告", stage="requirement")
    db.add(art)
    await db.flush()
    db.add(
        ArtifactVersion(artifact_id=art.id, version=1, content=md, author="agent:selfcheck")
    )
    await db.commit()
    await publish(
        session_id, "artifact.created", {"artifact_url": str(art.id), "kind": "selfcheck_report"}
    )
    return {"artifactId": str(art.id), "allGreen": result["allGreen"], "checks": result["checks"]}
