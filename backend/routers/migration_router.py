import uuid
from fastapi import APIRouter, Depends

from auth import get_current_user
from database import get_db
from models import ImportChatsRequest

router = APIRouter(prefix="/api/migrate", tags=["migration"])


@router.post("/import-chats")
async def import_chats(req: ImportChatsRequest, user=Depends(get_current_user), db=Depends(get_db)):
    imported = 0
    skipped = 0

    for chat_data in req.chats:
        try:
            chat_id = str(uuid.uuid4())
            await db.execute(
                "INSERT INTO chats (id, user_id, title) VALUES (?, ?, ?)",
                (chat_id, user["id"], chat_data.title),
            )

            for msg in chat_data.messages:
                msg_id = str(uuid.uuid4())
                await db.execute(
                    "INSERT INTO messages (id, chat_id, role, content, display_content) VALUES (?, ?, ?, ?, ?)",
                    (msg_id, chat_id, msg.role, msg.content, msg.displayContent),
                )

                if msg.files:
                    for f in msg.files:
                        file_id = str(uuid.uuid4())
                        await db.execute(
                            "INSERT INTO message_files (id, message_id, file_name, file_size, file_type) VALUES (?, ?, ?, ?, ?)",
                            (file_id, msg_id, f.get("name", "unknown"), f.get("size", 0), f.get("type")),
                        )

            imported += 1
        except Exception:
            skipped += 1

    await db.commit()
    return {"imported": imported, "skipped": skipped}
