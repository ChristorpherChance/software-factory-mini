"""资料 API（T-MAT / T-FE-05）：解析入库 + 列表 + 定稿 + 内容解析扩展。

POST /projects/{pid}/materials                   解析文本/文件，入库 artifact
GET  /projects/{pid}/materials                   列表（含 status）
POST /projects/{pid}/materials/{mid}/finalize    定稿（status → finalized）
POST /projects/{pid}/materials/{mid}/transform   内容解析：翻译/索引/脱敏/知识库增强
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth
from ...db import get_db
from ...models.entities import Artifact, ArtifactVersion, UploadedFile
from ...agents.material.pipeline import parse_material
from ...agents.material.extract import RAW_PREFIX
from ...core.events import publish
from ...schemas import MaterialIn
from ._common import ok, paged

router = APIRouter(tags=["materials"])


def _flatten(
    structured: dict,
    art_id: str,
    title: str,
    status: str = "draft",
    content_parsed: bool = False,
) -> dict:
    return {
        "id": art_id,
        "type": "material_parsed",
        "title": title,
        "status": status,
        "contentParsed": content_parsed,
        "rawText": structured.get("raw_text", ""),
        "summary": structured.get("summary", ""),
        "readinessScore": structured.get("readiness_score", 0.0),
        "readinessDimensions": structured.get("readiness_dimensions", {}),
        "missingItems": structured.get("missing_items", []),
        "keyPoints": structured.get("key_points", []),
        "quotes": structured.get("quotes", []),
        "tags": structured.get("tags", []),
    }


# ---------------------------------------------------------------------------
# stub 内容解析（翻译/索引/脱敏/知识库增强）
# ---------------------------------------------------------------------------
_TRANSFORM_STUBS: dict[str, str] = {
    "translate_en_zh": "【已翻译（英→中）stub 结果】\n\n{content}",
    "translate_fr_zh": "【已翻译（法→中）stub 结果】\n\n{content}",
    "translate_zh_en": "【Translated (ZH→EN) stub result】\n\n{content}",
    "index":           "【已建立索引 stub 结果】\n\n关键词索引：\n- Term A → §1\n- Term B → §2\n\n{content}",
    "desensitize":     "【已脱敏 stub 结果】\n\n（姓名/手机/邮箱已替换为占位符）\n\n{content}",
    "enrich":          "【知识库增强 stub 结果】\n\n补充术语：\n- 术语A: 定义A\n- 术语B: 定义B\n\n{content}",
}


@router.post("/projects/{pid}/materials")
async def create_material(
    pid: str, body: MaterialIn, db: AsyncSession = Depends(get_db), _=Depends(require_auth)
):
    # 支持 file_id：从已上传文件中读取内容解析
    if body.file_id:
        rec = await db.get(UploadedFile, body.file_id)
        if not rec or rec.project_id != pid:
            raise HTTPException(404, "file not found")
        # 直接把文件路径交给解析管线，由 detect_type + extract_text 按真实类型抽取
        # （md/txt/pdf/docx/图片OCR/链接均支持）；不再当纯文本直读字节，避免 PDF/Word 乱码。
        source = rec.path
        title = body.title or rec.name
        # 更新文件状态为 parsing
        rec.status = "parsing"
        await db.flush()
    else:
        source = (RAW_PREFIX + body.source) if body.isText else body.source
        title = body.title or "资料解析结果"

    structured = await parse_material(source)
    art = Artifact(project_id=pid, type="material_parsed", title=title, stage="material")
    db.add(art)
    await db.flush()
    db.add(
        ArtifactVersion(
            artifact_id=art.id,
            version=1,
            content=json.dumps(structured, ensure_ascii=False),
            author="agent:material",
        )
    )

    # 关联 file_id → parsed
    if body.file_id:
        rec.status = "parsed"
        rec.parsed_artifact_id = str(art.id)

    # scope：crd_ref/prd_ref = 需求阶段专用参考资料（不进资料库，见 list 过滤）
    extra = {**(art.extra or {}), "scope": body.scope}

    # 需求阶段上传的参考资料（scope=crd_ref，asReference）：立即可用——直接定稿 + 内容解析完成。
    # 资料阶段上传（scope=material）：两阶段独立定稿，asReference 不再自动置 content_parsed（问题6）。
    if body.asReference and body.scope != "material":
        art.status = "finalized"
        extra["content_parsed"] = True
    art.extra = extra

    await db.commit()
    await publish(pid, "artifact.created", {"artifact_url": str(art.id), "kind": "material_parsed"})
    return ok(
        _flatten(
            structured,
            str(art.id),
            title,
            status=art.status,
            content_parsed=bool((art.extra or {}).get("content_parsed")),
        )
    )


@router.get("/projects/{pid}/materials")
async def list_materials(
    pid: str,
    scope: str | None = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    """资料列表。scope 不传=资料阶段（仅 material，含旧数据无 scope）；scope=crd_ref 取需求阶段专用参考。"""
    arts = (
        await db.execute(
            select(Artifact)
            .where(
                Artifact.project_id == pid,
                Artifact.type == "material_parsed",
                Artifact.archived_at.is_(None),
            )
            .order_by(Artifact.created_at.desc())
        )
    ).scalars().all()
    out = []
    for a in arts:
        a_scope = (a.extra or {}).get("scope", "material")
        if scope is None:
            # 资料阶段：排除需求阶段专用参考（crd_ref/prd_ref）
            if a_scope != "material":
                continue
        elif a_scope != scope:
            continue
        v = (
            await db.execute(
                select(ArtifactVersion)
                .where(ArtifactVersion.artifact_id == a.id)
                .order_by(ArtifactVersion.version.desc())
                .limit(1)
            )
        ).scalars().first()
        try:
            structured = json.loads(v.content) if v and v.content else {}
        except Exception:
            structured = {}
        out.append(
            _flatten(
                structured,
                str(a.id),
                a.title,
                status=a.status,
                content_parsed=bool((a.extra or {}).get("content_parsed")),
            )
        )
    return paged(out)


@router.post("/projects/{pid}/materials/{mid}/finalize")
async def finalize_material(
    pid: str, mid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)
):
    """将资料 artifact 状态改为 finalized（文件解析定稿）。"""
    a = await db.get(Artifact, mid)
    if not a or a.project_id != pid or a.type != "material_parsed":
        raise HTTPException(404, "material not found")
    a.status = "finalized"
    await db.commit()
    await publish(pid, "artifact.created", {"artifact_url": str(a.id), "kind": "material_finalized"})
    return ok({"id": mid, "status": "finalized"})


@router.post("/projects/{pid}/materials/{mid}/transform")
async def transform_material(
    pid: str,
    mid: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    """内容解析扩展（翻译/索引/脱敏/知识库增强）。stub 返回确定性结果并写新版本。

    body: { op: str, params: dict }
    op 取值：translate_en_zh | translate_fr_zh | translate_zh_en | index | desensitize | enrich
    """
    a = await db.get(Artifact, mid)
    if not a or a.project_id != pid or a.type != "material_parsed":
        raise HTTPException(404, "material not found")

    op = body.get("op", "")
    if op not in _TRANSFORM_STUBS:
        raise HTTPException(400, f"unsupported op: {op}")

    # 取最新版本原文
    latest_v = (
        await db.execute(
            select(ArtifactVersion)
            .where(ArtifactVersion.artifact_id == mid)
            .order_by(ArtifactVersion.version.desc())
            .limit(1)
        )
    ).scalars().first()
    existing_content = (latest_v.content or "") if latest_v else ""

    # stub 转换
    new_content = _TRANSFORM_STUBS[op].format(content=existing_content)

    nv = a.current_version + 1
    db.add(
        ArtifactVersion(
            artifact_id=a.id,
            version=nv,
            content=new_content,
            author=f"agent:transform:{op}",
            note=f"transform:{op}",
        )
    )
    a.current_version, a.version = nv, a.version + 1
    # 注意（问题6）：transform 只产出新版本内容，**不再自动置 content_parsed**。
    # 内容解析定稿需用户显式调用 /finalize-content（两阶段独立定稿）。
    await db.commit()
    return ok({"version": nv, "content": new_content})


@router.post("/projects/{pid}/materials/{mid}/finalize-content")
async def finalize_content_material(
    pid: str, mid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)
):
    """内容解析定稿（问题6）：显式置 extra.content_parsed=true，与文件解析定稿(status)独立。"""
    a = await db.get(Artifact, mid)
    if not a or a.project_id != pid or a.type != "material_parsed":
        raise HTTPException(404, "material not found")
    a.extra = {**(a.extra or {}), "content_parsed": True}
    await db.commit()
    return ok({"id": mid, "contentParsed": True})


@router.delete("/projects/{pid}/materials/{mid}")
async def delete_material(
    pid: str, mid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)
):
    """删除已解析资料（问题5/7）：归档 artifact + 删关联上传文件记录与物理文件。

    两个 Tab 共用 materials 列表，删除后均同步消失。
    """
    from pathlib import Path

    a = await db.get(Artifact, mid)
    if not a or a.project_id != pid or a.type != "material_parsed":
        raise HTTPException(404, "material not found")
    # 反查关联上传文件（parsed_artifact_id == mid），删记录 + 物理文件
    files = (
        await db.execute(
            select(UploadedFile).where(
                UploadedFile.project_id == pid,
                UploadedFile.parsed_artifact_id == mid,
            )
        )
    ).scalars().all()
    for rec in files:
        try:
            Path(rec.path).unlink(missing_ok=True)
        except Exception:
            pass
        await db.delete(rec)
    # 归档 artifact（列表已按 archived_at is None 过滤，归档即消失）
    a.archived_at = func.now()
    await db.commit()
    return ok({"deleted": True})
