import uuid
import logging
from fastapi import APIRouter, Depends

import aiosqlite
from auth import get_current_user
from config import DB_PATH

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
async def get_notifications(user=Depends(get_current_user)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT id, title, message, type, is_read, related_doc_id, created_at
               FROM notifications
               WHERE user_id = ?
               ORDER BY created_at DESC
               LIMIT 50""",
            (user["id"],),
        )
        notifs = [dict(row) for row in await cursor.fetchall()]

    return {"notifications": notifs}


@router.post("/{notif_id}/read")
async def mark_read(notif_id: str, user=Depends(get_current_user)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
            (notif_id, user["id"]),
        )
        await db.commit()
    return {"ok": True}


@router.delete("/{notif_id}")
async def delete_notification(notif_id: str, user=Depends(get_current_user)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "DELETE FROM notifications WHERE id = ? AND user_id = ?",
            (notif_id, user["id"]),
        )
        await db.commit()
    return {"ok": True}


async def create_notification(user_id: str, title: str, message: str,
                               notif_type: str = "info", related_doc_id: str = None):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO notifications (id, user_id, title, message, type, related_doc_id)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (str(uuid.uuid4()), user_id, title, message, notif_type, related_doc_id),
        )
        await db.commit()
