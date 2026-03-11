import aiosqlite
import logging
import os
import uuid
from config import DB_PATH, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD

logger = logging.getLogger(__name__)

_db_path = DB_PATH


async def init_db():
    schema_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")
    async with aiosqlite.connect(_db_path) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")
        await db.execute("PRAGMA busy_timeout=5000")
        await db.execute("PRAGMA synchronous=NORMAL")
        await db.execute("PRAGMA cache_size=-8000")

        try:
            cursor = await db.execute("PRAGMA table_info(knowledge_documents)")
            columns = [row[1] for row in await cursor.fetchall()]
            if columns and "folder_id" not in columns:
                await db.execute("ALTER TABLE knowledge_documents ADD COLUMN folder_id TEXT REFERENCES knowledge_folders(id) ON DELETE SET NULL")
                await db.commit()
        except Exception:
            pass

        try:
            cursor = await db.execute("PRAGMA table_info(knowledge_documents)")
            columns = [row[1] for row in await cursor.fetchall()]
            if columns:
                new_cols = {
                    "doc_type": "TEXT",
                    "doc_type_label": "TEXT",
                    "doc_summary": "TEXT",
                    "entities_json": "TEXT",
                    "analyzed_at": "TEXT",
                    "is_indexed": "INTEGER DEFAULT 0",
                    "chunk_count": "INTEGER DEFAULT 0",
                    "indexed_at": "TEXT",
                }
                for col, col_type in new_cols.items():
                    if col not in columns:
                        await db.execute(f"ALTER TABLE knowledge_documents ADD COLUMN {col} {col_type}")
                await db.commit()
        except Exception:
            pass

        with open(schema_path, "r", encoding="utf-8") as f:
            schema = f.read()
        await db.executescript(schema)
        await db.commit()

        from config import BACKUP_DIR
        os.makedirs(BACKUP_DIR, exist_ok=True)

        cursor = await db.execute("SELECT id FROM users WHERE is_admin = 1")
        admin = await cursor.fetchone()
        if not admin:
            from auth import hash_password
            admin_id = str(uuid.uuid4())
            settings_id = str(uuid.uuid4())
            pw_hash = hash_password(DEFAULT_ADMIN_PASSWORD)
            await db.execute(
                """INSERT INTO users (id, email, password_hash, first_name, last_name,
                   patronymic, position, is_admin, is_active)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)""",
                (admin_id, DEFAULT_ADMIN_EMAIL, pw_hash, "Администратор", "", "", "Администратор"),
            )
            await db.execute(
                "INSERT INTO user_settings (id, user_id) VALUES (?, ?)",
                (settings_id, admin_id),
            )
            await db.commit()
            logger.info("Аккаунт администратора создан: %s", DEFAULT_ADMIN_EMAIL)
            print(f"\n{'='*50}")
            print(f"  Admin account created!")
            print(f"  Email:    {DEFAULT_ADMIN_EMAIL}")
            print(f"  Password: {DEFAULT_ADMIN_PASSWORD}")
            print(f"  CHANGE THIS PASSWORD IMMEDIATELY!")
            print(f"{'='*50}\n")


async def get_db():
    db = await aiosqlite.connect(_db_path)
    await db.execute("PRAGMA foreign_keys=ON")
    await db.execute("PRAGMA busy_timeout=5000")
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()
