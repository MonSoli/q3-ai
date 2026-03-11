import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

import aiosqlite
from auth import get_current_user
from config import DB_PATH
from analytics_engine import (
    analyze_document,
    get_analytics_dashboard,
    classify_document_fast,
    extract_entities,
    generate_summary,
)
from ocr_engine import get_ocr_status

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


class AnalyzeRequest(BaseModel):
    document_id: str
    model: str = "qwen3:4b"


class SummaryRequest(BaseModel):
    document_id: str
    model: str = "qwen3:4b"


@router.post("/analyze")
async def analyze_doc(req: AnalyzeRequest, user=Depends(get_current_user)):
    result = await analyze_document(req.document_id, req.model)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.get("/dashboard")
async def analytics_dashboard(user=Depends(get_current_user)):
    return await get_analytics_dashboard()


@router.get("/document/{doc_id}")
async def document_analytics(doc_id: str, user=Depends(get_current_user)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT id, filename, doc_type, doc_type_label, doc_summary,
                      entities_json, analyzed_at, created_at, file_size,
                      is_indexed, chunk_count
               FROM knowledge_documents WHERE id = ?""",
            (doc_id,),
        )
        doc = await cursor.fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")

        cursor = await db.execute(
            "SELECT tag, tag_type FROM document_tags WHERE document_id = ?",
            (doc_id,),
        )
        tags = [dict(row) for row in await cursor.fetchall()]

    result = dict(doc)
    result["tags"] = tags
    if result.get("entities_json"):
        try:
            result["entities"] = json.loads(result["entities_json"])
        except (json.JSONDecodeError, TypeError):
            result["entities"] = {}
    else:
        result["entities"] = {}

    return result


@router.post("/summary")
async def document_summary(req: SummaryRequest, user=Depends(get_current_user)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT content FROM knowledge_documents WHERE id = ?",
            (req.document_id,),
        )
        doc = await cursor.fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")

    summary = await generate_summary(doc["content"] or "", req.model)
    if summary:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "UPDATE knowledge_documents SET doc_summary = ? WHERE id = ?",
                (summary, req.document_id),
            )
            await db.commit()

    return {"summary": summary}


@router.get("/entities/{doc_id}")
async def document_entities(doc_id: str, user=Depends(get_current_user)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT content, filename FROM knowledge_documents WHERE id = ?",
            (doc_id,),
        )
        doc = await cursor.fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")

    entities = extract_entities(doc["content"] or "")
    classification = classify_document_fast(doc["content"] or "", doc["filename"])

    return {
        "document_id": doc_id,
        "entities": entities,
        "classification": classification,
    }


@router.get("/tags")
async def all_tags(user=Depends(get_current_user)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT tag, tag_type, COUNT(*) as count
               FROM document_tags
               GROUP BY tag, tag_type
               ORDER BY count DESC"""
        )
        tags = [dict(row) for row in await cursor.fetchall()]

    return {"tags": tags}


@router.get("/timeline")
async def document_timeline(user=Depends(get_current_user)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT id, filename, doc_type, doc_type_label,
                      created_at, updated_at, analyzed_at,
                      file_size, uploaded_by
               FROM knowledge_documents
               ORDER BY created_at DESC
               LIMIT 100"""
        )
        docs = [dict(row) for row in await cursor.fetchall()]

    return {"timeline": docs}


@router.get("/ocr-status")
async def ocr_status(user=Depends(get_current_user)):
    return get_ocr_status()


@router.get("/knowledge-graph")
async def knowledge_graph(user=Depends(get_current_user)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        cursor = await db.execute(
            """SELECT id, filename, doc_type, doc_type_label, entities_json
               FROM knowledge_documents
               WHERE entities_json IS NOT NULL"""
        )
        docs = await cursor.fetchall()

    nodes = []
    edges = []
    org_to_docs = {}

    for doc in docs:
        nodes.append({
            "id": doc["id"],
            "label": doc["filename"],
            "type": doc["doc_type"] or "other",
            "group": "document",
        })

        try:
            entities = json.loads(doc["entities_json"])
            for org in entities.get("organizations", []):
                if org not in org_to_docs:
                    org_to_docs[org] = []
                org_to_docs[org].append(doc["id"])
        except (json.JSONDecodeError, TypeError):
            pass

    for org, doc_ids in org_to_docs.items():
        org_id = f"org_{hash(org)}"
        nodes.append({
            "id": org_id,
            "label": org,
            "type": "organization",
            "group": "entity",
        })
        for doc_id in doc_ids:
            edges.append({
                "source": doc_id,
                "target": org_id,
                "relation": "mentions",
            })

        if len(doc_ids) > 1:
            for i in range(len(doc_ids)):
                for j in range(i + 1, len(doc_ids)):
                    edges.append({
                        "source": doc_ids[i],
                        "target": doc_ids[j],
                        "relation": "shared_entity",
                        "entity": org,
                    })

    return {"nodes": nodes, "edges": edges}
