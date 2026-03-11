import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from auth import get_admin_user, USER_FIELDS, _user_dict
from database import get_db
from models import AdminCreateUserRequest, AdminUpdateUserRequest

router = APIRouter(prefix="/api/admin", tags=["admin"])


async def _audit_log(db, user, action, target_type=None, target_id=None, details=None, ip=None):
    try:
        log_id = str(uuid.uuid4())
        await db.execute(
            """INSERT INTO audit_log (id, user_id, user_email, action, target_type, target_id, details, ip_address)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (log_id, user["id"], user.get("email", ""), action, target_type, target_id, details, ip),
        )
    except Exception:
        pass


@router.get("/users")
async def list_users(admin=Depends(get_admin_user), db=Depends(get_db)):
    cursor = await db.execute(f"SELECT {USER_FIELDS}, password_hash FROM users ORDER BY created_at DESC")
    rows = await cursor.fetchall()
    users = []
    for row in rows:
        u = _user_dict(row)
        u["is_registered"] = row["password_hash"] is not None
        users.append(u)
    return {"users": users}


@router.post("/users")
async def create_user(req: AdminCreateUserRequest, admin=Depends(get_admin_user), db=Depends(get_db)):
    email = req.email.strip().lower()

    cursor = await db.execute(
        "SELECT id FROM users WHERE email = ? COLLATE NOCASE",
        (email,),
    )
    if await cursor.fetchone():
        raise HTTPException(status_code=400, detail="Пользователь с таким email уже существует")

    user_id = str(uuid.uuid4())
    await db.execute(
        """INSERT INTO users (id, email, first_name, last_name, patronymic, position,
           password_hash, is_admin, is_active)
           VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 0)""",
        (user_id, email, req.first_name, req.last_name,
         req.patronymic or "", req.position or ""),
    )
    settings_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO user_settings (id, user_id) VALUES (?, ?)",
        (settings_id, user_id),
    )
    await _audit_log(db, admin, "create_user", "user", user_id, f"email={email}")
    await db.commit()

    cursor = await db.execute(f"SELECT {USER_FIELDS} FROM users WHERE id = ?", (user_id,))
    user = _user_dict(await cursor.fetchone())
    user["is_registered"] = False
    return user


@router.get("/users/{user_id}")
async def get_user(user_id: str, admin=Depends(get_admin_user), db=Depends(get_db)):
    cursor = await db.execute(f"SELECT {USER_FIELDS}, password_hash FROM users WHERE id = ?", (user_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    user = _user_dict(row)
    user["is_registered"] = row["password_hash"] is not None
    return user


@router.put("/users/{user_id}")
async def update_user(user_id: str, req: AdminUpdateUserRequest,
                      admin=Depends(get_admin_user), db=Depends(get_db)):
    if user_id == admin["id"] and req.is_active is False:
        raise HTTPException(status_code=400, detail="Нельзя деактивировать собственный аккаунт")

    cursor = await db.execute("SELECT id FROM users WHERE id = ?", (user_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    updates = []
    params = []

    if req.email is not None:
        email = req.email.strip().lower()
        cursor = await db.execute(
            "SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id != ?",
            (email, user_id),
        )
        if await cursor.fetchone():
            raise HTTPException(status_code=400, detail="Email уже используется")
        updates.append("email = ?")
        params.append(email)

    if req.first_name is not None:
        updates.append("first_name = ?")
        params.append(req.first_name)

    if req.last_name is not None:
        updates.append("last_name = ?")
        params.append(req.last_name)

    if req.patronymic is not None:
        updates.append("patronymic = ?")
        params.append(req.patronymic)

    if req.position is not None:
        updates.append("position = ?")
        params.append(req.position)

    if req.is_active is not None:
        updates.append("is_active = ?")
        params.append(1 if req.is_active else 0)

    if updates:
        updates.append("updated_at = datetime('now')")
        params.append(user_id)
        await db.execute(
            f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params,
        )
        await db.commit()

    cursor = await db.execute(f"SELECT {USER_FIELDS}, password_hash FROM users WHERE id = ?", (user_id,))
    row = await cursor.fetchone()
    user = _user_dict(row)
    user["is_registered"] = row["password_hash"] is not None
    return user


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, admin=Depends(get_admin_user), db=Depends(get_db)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Нельзя удалить собственный аккаунт")

    cursor = await db.execute("SELECT id FROM users WHERE id = ?", (user_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    await _audit_log(db, admin, "delete_user", "user", user_id)
    await db.commit()
    return {"message": "Пользователь удалён"}


@router.get("/audit-log")
async def get_audit_log(limit: int = 100, offset: int = 0, admin=Depends(get_admin_user), db=Depends(get_db)):
    cursor = await db.execute(
        """SELECT id, user_id, user_email, action, target_type, target_id, details, ip_address, created_at
           FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?""",
        (limit, offset),
    )
    rows = await cursor.fetchall()
    return {"entries": [dict(r) for r in rows]}
