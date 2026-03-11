import uuid
from fastapi import APIRouter, Depends, HTTPException, status, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    get_current_user,
    USER_FIELDS,
    _user_dict,
)
from database import get_db
from models import RegisterRequest, LoginRequest, RefreshRequest, ChangePasswordRequest, CheckEmailRequest
from config import SECRET_KEY, ALGORITHM, RATE_LIMIT_LOGIN
from jose import JWTError, jwt

router = APIRouter(prefix="/api/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)


@router.post("/register")
@limiter.limit(RATE_LIMIT_LOGIN)
async def register(request: Request, req: RegisterRequest, db=Depends(get_db)):
    email = req.email.strip().lower()

    cursor = await db.execute(
        "SELECT id, password_hash, is_active FROM users WHERE email = ? COLLATE NOCASE",
        (email,),
    )
    user = await cursor.fetchone()

    if not user:
        raise HTTPException(
            status_code=403,
            detail="Регистрация невозможна. Ваш email не авторизован администратором."
        )

    user = dict(user)

    if user["password_hash"] is not None:
        raise HTTPException(
            status_code=400,
            detail="Аккаунт уже зарегистрирован. Используйте вход."
        )

    pw_hash = hash_password(req.password)
    await db.execute(
        "UPDATE users SET password_hash = ?, is_active = 1, updated_at = datetime('now') WHERE id = ?",
        (pw_hash, user["id"]),
    )

    settings_id = str(uuid.uuid4())
    await db.execute(
        "INSERT OR IGNORE INTO user_settings (id, user_id) VALUES (?, ?)",
        (settings_id, user["id"]),
    )
    await db.commit()

    cursor = await db.execute(f"SELECT {USER_FIELDS} FROM users WHERE id = ?", (user["id"],))
    full_user = _user_dict(await cursor.fetchone())

    token = create_access_token({"sub": full_user["id"]})
    refresh = create_refresh_token({"sub": full_user["id"]})

    return {"user": full_user, "token": token, "refresh_token": refresh}


@router.post("/login")
@limiter.limit(RATE_LIMIT_LOGIN)
async def login(request: Request, req: LoginRequest, db=Depends(get_db)):
    email = req.email.strip().lower()

    cursor = await db.execute(
        f"SELECT {USER_FIELDS}, password_hash FROM users WHERE email = ? COLLATE NOCASE",
        (email,),
    )
    user = await cursor.fetchone()

    if not user:
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    user = dict(user)

    if user["password_hash"] is None:
        raise HTTPException(
            status_code=401,
            detail="Аккаунт создан, но не активирован. Пройдите регистрацию."
        )

    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Аккаунт деактивирован")

    user_data = {k: v for k, v in user.items() if k != "password_hash"}
    user_data["is_admin"] = bool(user_data["is_admin"])
    user_data["is_active"] = bool(user_data["is_active"])

    token = create_access_token({"sub": user["id"]})
    refresh = create_refresh_token({"sub": user["id"]})

    return {"user": user_data, "token": token, "refresh_token": refresh}


@router.post("/refresh")
async def refresh_token(req: RefreshRequest, db=Depends(get_db)):
    try:
        payload = jwt.decode(req.refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        token_type = payload.get("type")
        if not user_id or token_type != "refresh":
            raise HTTPException(status_code=401, detail="Недействительный refresh токен")
    except JWTError:
        raise HTTPException(status_code=401, detail="Недействительный refresh токен")

    cursor = await db.execute("SELECT id, is_active FROM users WHERE id = ?", (user_id,))
    user = await cursor.fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="Пользователь не найден")

    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Аккаунт деактивирован")

    new_token = create_access_token({"sub": user_id})
    new_refresh = create_refresh_token({"sub": user_id})
    return {"token": new_token, "refresh_token": new_refresh}


@router.post("/check-email")
async def check_email(req: CheckEmailRequest, db=Depends(get_db)):
    email = req.email.strip().lower()

    cursor = await db.execute(
        "SELECT id, password_hash FROM users WHERE email = ? COLLATE NOCASE",
        (email,),
    )
    user = await cursor.fetchone()

    if not user:
        return {"status": "not_found", "message": "Email не авторизован администратором"}

    user = dict(user)
    if user["password_hash"] is not None:
        return {"status": "already_registered", "message": "Аккаунт уже зарегистрирован"}

    return {"status": "available", "message": "Email доступен для регистрации"}


@router.get("/me")
async def me(user=Depends(get_current_user)):
    return user


@router.put("/me/password")
async def change_password(req: ChangePasswordRequest, user=Depends(get_current_user), db=Depends(get_db)):
    cursor = await db.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],))
    row = await cursor.fetchone()
    if not verify_password(req.current_password, row["password_hash"]):
        raise HTTPException(status_code=400, detail="Неверный текущий пароль")

    pw_hash = hash_password(req.new_password)
    await db.execute(
        "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
        (pw_hash, user["id"]),
    )
    await db.commit()
    return {"message": "Пароль успешно изменён"}
