import os
import uuid
import shutil
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from auth import get_admin_user
from database import get_db
from config import DB_PATH, BACKUP_DIR
from models import CreateBackupRequest

router = APIRouter(prefix="/api/admin/backups", tags=["backups"])


@router.get("")
async def list_backups(admin=Depends(get_admin_user), db=Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, filename, file_size, created_by, created_at, note FROM backups ORDER BY created_at DESC"
    )
    rows = await cursor.fetchall()
    return {"backups": [dict(row) for row in rows]}


@router.post("")
async def create_backup(
    req: CreateBackupRequest = CreateBackupRequest(),
    admin=Depends(get_admin_user),
    db=Depends(get_db)
):
    os.makedirs(BACKUP_DIR, exist_ok=True)

    backup_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"backup_{timestamp}.db"
    backup_path = os.path.join(BACKUP_DIR, filename)

    try:
        shutil.copy2(DB_PATH, backup_path)
        file_size = os.path.getsize(backup_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка создания бекапа: {str(e)}")

    admin_name = f"{admin.get('last_name', '')} {admin.get('first_name', '')}".strip() or admin.get('email', '')

    await db.execute(
        "INSERT INTO backups (id, filename, file_size, created_by, created_at, note) VALUES (?, ?, ?, ?, ?, ?)",
        (backup_id, filename, file_size, admin_name, datetime.now(timezone.utc).isoformat(), req.note or "")
    )
    await db.commit()

    return {
        "id": backup_id,
        "filename": filename,
        "file_size": file_size,
        "message": "Резервная копия создана"
    }


@router.post("/{backup_id}/restore")
async def restore_backup(backup_id: str, admin=Depends(get_admin_user), db=Depends(get_db)):
    cursor = await db.execute("SELECT filename FROM backups WHERE id = ?", (backup_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Бекап не найден")

    backup_path = os.path.join(BACKUP_DIR, row["filename"])
    if not os.path.exists(backup_path):
        raise HTTPException(status_code=404, detail="Файл бекапа не найден на диске")

    try:
        safety_dir = os.path.join(BACKUP_DIR, "_safety")
        os.makedirs(safety_dir, exist_ok=True)
        safety_filename = f"pre_restore_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.db"
        shutil.copy2(DB_PATH, os.path.join(safety_dir, safety_filename))

        try:
            await db.close()
        except Exception:
            pass
        shutil.copy2(backup_path, DB_PATH)
        for suffix in ("-wal", "-shm"):
            wal_path = DB_PATH + suffix
            if os.path.exists(wal_path):
                os.remove(wal_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка восстановления: {str(e)}")

    return {"message": "База данных восстановлена. Страница будет перезагружена.", "needs_restart": True}


@router.delete("/{backup_id}")
async def delete_backup(backup_id: str, admin=Depends(get_admin_user), db=Depends(get_db)):
    cursor = await db.execute("SELECT filename FROM backups WHERE id = ?", (backup_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Бекап не найден")

    backup_path = os.path.join(BACKUP_DIR, row["filename"])
    if os.path.exists(backup_path):
        os.remove(backup_path)

    await db.execute("DELETE FROM backups WHERE id = ?", (backup_id,))
    await db.commit()

    return {"message": "Бекап удалён"}
