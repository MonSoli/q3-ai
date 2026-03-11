import uuid
from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from database import get_db
from models import CreateChatRequest, UpdateChatRequest, CreateMessageRequest

router = APIRouter(prefix="/api/chats", tags=["chats"])


@router.get("/search")
async def search_messages(q: str, limit: int = 50, user=Depends(get_current_user), db=Depends(get_db)):
    if not q or len(q) < 2:
        return []

    fts_query = '"' + q.replace('"', '""') + '"'

    try:
        cursor = await db.execute(
            """SELECT m.id, m.chat_id, m.role, m.content, m.created_at,
                      c.title as chat_title
               FROM messages m
               JOIN messages_fts fts ON m.rowid = fts.rowid
               JOIN chats c ON m.chat_id = c.id
               WHERE messages_fts MATCH ? AND c.user_id = ?
               ORDER BY m.created_at DESC
               LIMIT ?""",
            (fts_query, user["id"], limit),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    except Exception:
        search_term = f"%{q}%"
        cursor = await db.execute(
            """SELECT m.id, m.chat_id, m.role, m.content, m.created_at,
                      c.title as chat_title
               FROM messages m
               JOIN chats c ON m.chat_id = c.id
               WHERE c.user_id = ? AND m.content LIKE ?
               ORDER BY m.created_at DESC
               LIMIT ?""",
            (user["id"], search_term, limit),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


@router.get("")
async def list_chats(limit: int = 50, offset: int = 0, user=Depends(get_current_user), db=Depends(get_db)):
    cursor = await db.execute(
        """SELECT c.id, c.title, c.updated_at, c.created_at,
                  (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) as message_count
           FROM chats c
           WHERE c.user_id = ?
           ORDER BY c.updated_at DESC
           LIMIT ? OFFSET ?""",
        (user["id"], limit, offset),
    )
    rows = await cursor.fetchall()
    return {"chats": [dict(r) for r in rows]}


@router.post("")
async def create_chat(req: CreateChatRequest, user=Depends(get_current_user), db=Depends(get_db)):
    chat_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO chats (id, user_id, title) VALUES (?, ?, ?)",
        (chat_id, user["id"], req.title),
    )
    await db.commit()
    return {"id": chat_id, "title": req.title}


@router.get("/{chat_id}")
async def get_chat(chat_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, title, created_at, updated_at FROM chats WHERE id = ? AND user_id = ?",
        (chat_id, user["id"]),
    )
    chat = await cursor.fetchone()
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")

    cursor = await db.execute(
        "SELECT id, role, content, display_content, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC",
        (chat_id,),
    )
    messages = await cursor.fetchall()

    msg_ids = [msg["id"] for msg in messages]
    files_by_msg = {}
    if msg_ids:
        placeholders = ",".join("?" * len(msg_ids))
        fcursor = await db.execute(
            f"SELECT message_id, file_name, file_size FROM message_files WHERE message_id IN ({placeholders})",
            msg_ids,
        )
        for f in await fcursor.fetchall():
            files_by_msg.setdefault(f["message_id"], []).append(
                {"name": f["file_name"], "size": f["file_size"]}
            )

    result_messages = []
    for msg in messages:
        msg_dict = dict(msg)
        msg_dict["files"] = files_by_msg.get(msg_dict["id"], [])
        result_messages.append(msg_dict)

    return {
        "id": chat["id"],
        "title": chat["title"],
        "created_at": chat["created_at"],
        "updated_at": chat["updated_at"],
        "messages": result_messages,
    }


@router.put("/{chat_id}")
async def update_chat(chat_id: str, req: UpdateChatRequest, user=Depends(get_current_user), db=Depends(get_db)):
    cursor = await db.execute("SELECT id FROM chats WHERE id = ? AND user_id = ?", (chat_id, user["id"]))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Чат не найден")

    await db.execute(
        "UPDATE chats SET title = ?, updated_at = datetime('now') WHERE id = ?",
        (req.title, chat_id),
    )
    await db.commit()
    return {"id": chat_id, "title": req.title}


@router.delete("/{chat_id}")
async def delete_chat(chat_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    cursor = await db.execute("SELECT id FROM chats WHERE id = ? AND user_id = ?", (chat_id, user["id"]))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Чат не найден")

    await db.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
    await db.commit()
    return {"status": "ok"}


@router.post("/{chat_id}/messages")
async def create_message(chat_id: str, req: CreateMessageRequest, user=Depends(get_current_user), db=Depends(get_db)):
    cursor = await db.execute("SELECT id FROM chats WHERE id = ? AND user_id = ?", (chat_id, user["id"]))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Чат не найден")

    msg_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO messages (id, chat_id, role, content, display_content) VALUES (?, ?, ?, ?, ?)",
        (msg_id, chat_id, req.role, req.content, req.display_content),
    )

    if req.files:
        for f in req.files:
            file_id = str(uuid.uuid4())
            await db.execute(
                "INSERT INTO message_files (id, message_id, file_name, file_size, file_type) VALUES (?, ?, ?, ?, ?)",
                (file_id, msg_id, f.name, f.size, f.type),
            )

    await db.execute("UPDATE chats SET updated_at = datetime('now') WHERE id = ?", (chat_id,))
    await db.commit()

    return {"id": msg_id, "role": req.role, "content": req.content}
