import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional

from auth import get_current_user
from rag_engine import (
    semantic_search,
    hybrid_search,
    index_document,
    reindex_all_documents,
    get_rag_context,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rag", tags=["RAG"])


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5
    min_score: float = 0.3
    search_type: str = "hybrid"


class IndexRequest(BaseModel):
    document_id: str


class RAGContextRequest(BaseModel):
    query: str
    max_tokens: int = 4000


@router.post("/search")
async def rag_search(req: SearchRequest, user=Depends(get_current_user)):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Запрос не может быть пустым")

    if req.search_type == "semantic":
        results = await semantic_search(req.query, top_k=req.top_k, min_score=req.min_score)
    elif req.search_type == "hybrid":
        results = await hybrid_search(req.query, top_k=req.top_k)
    else:
        results = await hybrid_search(req.query, top_k=req.top_k)

    return {"query": req.query, "results": results, "count": len(results)}


@router.post("/context")
async def rag_context(req: RAGContextRequest, user=Depends(get_current_user)):
    context = await get_rag_context(req.query, max_tokens=req.max_tokens)
    return {"context": context, "has_context": bool(context)}


@router.post("/index")
async def index_single_document(req: IndexRequest, background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    import aiosqlite
    from config import DB_PATH

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, filename, content FROM knowledge_documents WHERE id = ?",
            (req.document_id,),
        )
        doc = await cursor.fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")

    chunks = await index_document(doc["id"], doc["filename"], doc["content"] or "")
    return {"document_id": req.document_id, "chunks_indexed": chunks}


@router.post("/reindex")
async def reindex_all(user=Depends(get_current_user)):
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Только для администратора")

    result = await reindex_all_documents()
    return result


@router.get("/status")
async def rag_status(user=Depends(get_current_user)):
    import aiosqlite
    from config import DB_PATH

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        cursor = await db.execute("SELECT COUNT(*) as cnt FROM knowledge_documents")
        total_docs = (await cursor.fetchone())["cnt"]

        cursor = await db.execute(
            "SELECT COUNT(*) as cnt FROM knowledge_documents WHERE is_indexed = 1"
        )
        indexed_docs = (await cursor.fetchone())["cnt"]

        cursor = await db.execute("SELECT COUNT(*) as cnt FROM document_chunks")
        total_chunks = (await cursor.fetchone())["cnt"]

    return {
        "total_documents": total_docs,
        "indexed_documents": indexed_docs,
        "total_chunks": total_chunks,
        "indexing_complete": total_docs == indexed_docs,
    }
