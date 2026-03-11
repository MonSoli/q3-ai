import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status

from auth import get_current_user
from database import get_db
from config import MAX_UPLOAD_SIZE

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.get("")
async def list_documents(limit: int = 50, offset: int = 0, user=Depends(get_current_user), db=Depends(get_db)):
    cursor = await db.execute(
        """SELECT id, file_name, file_size, file_type, created_at
           FROM documents
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?""",
        (user["id"], limit, offset),
    )
    rows = await cursor.fetchall()
    return {"documents": [dict(r) for r in rows]}


@router.post("")
async def upload_document(file: UploadFile = File(...), user=Depends(get_current_user), db=Depends(get_db)):
    doc_id = str(uuid.uuid4())
    data = await file.read(MAX_UPLOAD_SIZE + 1)
    if len(data) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Файл слишком большой. Максимальный размер: {MAX_UPLOAD_SIZE // (1024 * 1024)} МБ"
        )
    content = None

    ext = ("." + file.filename.rsplit(".", 1)[-1].lower()) if "." in file.filename else ""

    if ext == ".pdf":
        try:
            import io
            try:
                import pypdf
                reader = pypdf.PdfReader(io.BytesIO(data))
                content = "\n".join(page.extract_text() or "" for page in reader.pages)
            except ImportError:
                try:
                    import PyPDF2
                    reader = PyPDF2.PdfReader(io.BytesIO(data))
                    content = "\n".join(page.extract_text() or "" for page in reader.pages)
                except ImportError:
                    content = "[PDF — для извлечения текста установите pypdf]"
        except Exception as e:
            content = f"[Ошибка чтения PDF: {e}]"
    elif ext in [".doc", ".docx"]:
        try:
            import io, docx
            doc = docx.Document(io.BytesIO(data))
            content = "\n".join(p.text for p in doc.paragraphs)
        except Exception:
            content = None
    else:
        try:
            content = data.decode("utf-8")
        except (UnicodeDecodeError, ValueError):
            try:
                content = data.decode("cp1251")
            except (UnicodeDecodeError, ValueError):
                pass

    await db.execute(
        "INSERT INTO documents (id, user_id, file_name, file_size, file_type, content, blob_data) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (doc_id, user["id"], file.filename, len(data), file.content_type, content, data),
    )
    await db.commit()

    return {"id": doc_id, "file_name": file.filename, "file_size": len(data), "file_type": file.content_type}


@router.get("/{doc_id}")
async def get_document(doc_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, file_name, file_size, file_type, content, created_at FROM documents WHERE id = ? AND user_id = ?",
        (doc_id, user["id"]),
    )
    doc = await cursor.fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    return dict(doc)


@router.delete("/{doc_id}")
async def delete_document(doc_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    cursor = await db.execute("SELECT id FROM documents WHERE id = ? AND user_id = ?", (doc_id, user["id"]))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Документ не найден")

    await db.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    await db.commit()
    return {"status": "ok"}
