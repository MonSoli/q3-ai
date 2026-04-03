import json
import re
import logging
import hashlib
from typing import List, Optional

import httpx
import numpy as np
import aiosqlite

from config import OLLAMA_BASE_URL, DB_PATH

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1500
CHUNK_OVERLAP = 150


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[dict]:
    if not text or not text.strip():
        return []

    text = re.sub(r'\n{3,}', '\n\n', text).strip()

    paragraphs = re.split(r'\n\n+', text)
    chunks = []
    current_chunk = ""
    current_start = 0
    char_pos = 0

    for para in paragraphs:
        if len(current_chunk) + len(para) + 2 <= chunk_size:
            if current_chunk:
                current_chunk += "\n\n" + para
            else:
                current_chunk = para
                current_start = char_pos
        else:
            if current_chunk:
                chunks.append({
                    "text": current_chunk.strip(),
                    "start": current_start,
                    "end": current_start + len(current_chunk),
                })
            if overlap > 0 and current_chunk:
                overlap_text = current_chunk[-overlap:]
                current_chunk = overlap_text + "\n\n" + para
            else:
                current_chunk = para
            current_start = char_pos
        char_pos += len(para) + 2

    if current_chunk.strip():
        chunks.append({
            "text": current_chunk.strip(),
            "start": current_start,
            "end": current_start + len(current_chunk),
        })

    if not chunks and text:
        for i in range(0, len(text), chunk_size - overlap):
            chunk = text[i:i + chunk_size]
            if chunk.strip():
                chunks.append({
                    "text": chunk.strip(),
                    "start": i,
                    "end": min(i + chunk_size, len(text)),
                })

    return chunks


def content_hash(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


EMBEDDING_MODEL = "nomic-embed-text"


async def get_embedding(text: str, model: str = EMBEDDING_MODEL) -> Optional[List[float]]:
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/embeddings",
                json={"model": model, "prompt": text},
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("embedding")
            else:
                logger.warning("Embedding request failed: %d %s", resp.status_code, resp.text[:200])
                return None
    except Exception as e:
        logger.warning("Embedding error: %s", e)
        return None


async def get_embeddings_batch(texts: List[str], model: str = EMBEDDING_MODEL, concurrency: int = 5) -> List[Optional[List[float]]]:
    import asyncio
    semaphore = asyncio.Semaphore(concurrency)

    async def _get(text):
        async with semaphore:
            return await get_embedding(text, model)

    return await asyncio.gather(*[_get(t) for t in texts])


def cosine_similarity(a: List[float], b: List[float]) -> float:
    a_np = np.array(a, dtype=np.float32)
    b_np = np.array(b, dtype=np.float32)
    dot = np.dot(a_np, b_np)
    norm_a = np.linalg.norm(a_np)
    norm_b = np.linalg.norm(b_np)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))


async def index_document(doc_id: str, filename: str, content: str, folder_id: Optional[str] = None):
    if not content or not content.strip():
        return 0

    chunks = chunk_text(content)
    if not chunks:
        return 0

    embeddings = await get_embeddings_batch([c["text"] for c in chunks])

    indexed = 0
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys=ON")

        await db.execute("DELETE FROM document_chunks WHERE document_id = ?", (doc_id,))

        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            if embedding is None:
                continue

            chunk_id = f"{doc_id}_chunk_{i}"
            await db.execute(
                """INSERT OR REPLACE INTO document_chunks
                   (id, document_id, chunk_index, content, embedding, char_start, char_end, content_hash)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    chunk_id,
                    doc_id,
                    i,
                    chunk["text"],
                    json.dumps(embedding),
                    chunk["start"],
                    chunk["end"],
                    content_hash(chunk["text"]),
                ),
            )
            indexed += 1

        await db.execute(
            "UPDATE knowledge_documents SET is_indexed = 1, chunk_count = ?, indexed_at = datetime('now') WHERE id = ?",
            (indexed, doc_id),
        )
        await db.commit()

    logger.info("Indexed document %s: %d chunks", filename, indexed)
    return indexed


async def semantic_search(query: str, top_k: int = 5, min_score: float = 0.3) -> List[dict]:
    query_embedding = await get_embedding(query)
    if query_embedding is None:
        return []

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT dc.id, dc.document_id, dc.content, dc.embedding,
                      dc.chunk_index, dc.char_start, dc.char_end,
                      kd.filename, kd.folder_id
               FROM document_chunks dc
               JOIN knowledge_documents kd ON dc.document_id = kd.id"""
        )
        rows = await cursor.fetchall()

    results = []
    for row in rows:
        try:
            chunk_embedding = json.loads(row["embedding"])
            score = cosine_similarity(query_embedding, chunk_embedding)
            if score >= min_score:
                results.append({
                    "chunk_id": row["id"],
                    "document_id": row["document_id"],
                    "filename": row["filename"],
                    "content": row["content"],
                    "score": round(score, 4),
                    "chunk_index": row["chunk_index"],
                    "char_start": row["char_start"],
                    "char_end": row["char_end"],
                })
        except (json.JSONDecodeError, TypeError):
            continue

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]


async def hybrid_search(query: str, top_k: int = 10) -> List[dict]:
    semantic_results = await semantic_search(query, top_k=top_k * 2, min_score=0.2)

    keyword_results = []
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        search_term = f"%{query}%"
        cursor = await db.execute(
            """SELECT dc.id, dc.document_id, dc.content, dc.chunk_index,
                      dc.char_start, dc.char_end, kd.filename
               FROM document_chunks dc
               JOIN knowledge_documents kd ON dc.document_id = kd.id
               WHERE dc.content LIKE ?
               LIMIT ?""",
            (search_term, top_k * 2),
        )
        for row in await cursor.fetchall():
            keyword_results.append({
                "chunk_id": row["id"],
                "document_id": row["document_id"],
                "filename": row["filename"],
                "content": row["content"],
                "score": 0.5,
                "chunk_index": row["chunk_index"],
                "char_start": row["char_start"],
                "char_end": row["char_end"],
                "match_type": "keyword",
            })

    seen = {}
    for r in semantic_results:
        r["match_type"] = "semantic"
        seen[r["chunk_id"]] = r

    for r in keyword_results:
        if r["chunk_id"] in seen:
            seen[r["chunk_id"]]["score"] = min(seen[r["chunk_id"]]["score"] + 0.2, 1.0)
            seen[r["chunk_id"]]["match_type"] = "hybrid"
        else:
            seen[r["chunk_id"]] = r

    merged = list(seen.values())
    merged.sort(key=lambda x: x["score"], reverse=True)
    return merged[:top_k]


async def get_rag_context(query: str, max_tokens: int = 4000) -> str:
    results = await hybrid_search(query, top_k=8)
    if not results:
        return ""

    # Data Shield: деанонимизация чанков для RAG-контекста
    from data_shield import deanonymize_document

    context_parts = []
    total_chars = 0
    char_limit = max_tokens * 3

    for r in results:
        content = r["content"]
        # Деанонимизируем содержимое чанка
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            content = await deanonymize_document(db, r["document_id"], content)

        chunk_text_str = f"[{r['filename']}] {content}"
        if total_chars + len(chunk_text_str) > char_limit:
            break
        context_parts.append(chunk_text_str)
        total_chars += len(chunk_text_str)

    return "\n\n---\n\n".join(context_parts)


async def reindex_all_documents():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, filename, content FROM knowledge_documents WHERE content IS NOT NULL AND content != ''"
        )
        docs = await cursor.fetchall()

    total = 0
    for doc in docs:
        count = await index_document(doc["id"], doc["filename"], doc["content"])
        total += count

    logger.info("Reindexed %d documents, %d total chunks", len(docs), total)
    return {"documents": len(docs), "chunks": total}
