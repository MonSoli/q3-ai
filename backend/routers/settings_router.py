from fastapi import APIRouter, Depends

from auth import get_current_user
from database import get_db
from models import UpdateSettingsRequest

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
async def get_settings(user=Depends(get_current_user), db=Depends(get_db)):
    cursor = await db.execute(
        "SELECT model, temperature, thinking, num_ctx FROM user_settings WHERE user_id = ?",
        (user["id"],),
    )
    row = await cursor.fetchone()
    if not row:
        return {"model": "qwen3:4b", "temperature": 0.7, "thinking": True, "num_ctx": 4096}
    settings = dict(row)
    settings["thinking"] = bool(settings["thinking"])
    return settings


@router.put("")
async def update_settings(req: UpdateSettingsRequest, user=Depends(get_current_user), db=Depends(get_db)):
    updates = []
    params = []

    if req.model is not None:
        updates.append("model = ?")
        params.append(req.model)
    if req.temperature is not None:
        updates.append("temperature = ?")
        params.append(req.temperature)
    if req.thinking is not None:
        updates.append("thinking = ?")
        params.append(1 if req.thinking else 0)
    if req.num_ctx is not None:
        updates.append("num_ctx = ?")
        params.append(req.num_ctx)

    if updates:
        updates.append("updated_at = datetime('now')")
        params.append(user["id"])
        await db.execute(
            f"UPDATE user_settings SET {', '.join(updates)} WHERE user_id = ?",
            params,
        )
        await db.commit()

    cursor = await db.execute(
        "SELECT model, temperature, thinking, num_ctx FROM user_settings WHERE user_id = ?",
        (user["id"],),
    )
    row = await cursor.fetchone()
    settings = dict(row)
    settings["thinking"] = bool(settings["thinking"])
    return settings
