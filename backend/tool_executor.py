import json
import uuid
from datetime import datetime, timezone


def _now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


async def resolve_folder_path(db, path: str):
    if not path or path == "/":
        return None
    parts = [p for p in path.strip("/").split("/") if p]
    current_parent = None
    for part in parts:
        if current_parent is None:
            cursor = await db.execute(
                "SELECT id FROM knowledge_folders WHERE name = ? AND parent_id IS NULL",
                (part,)
            )
        else:
            cursor = await db.execute(
                "SELECT id FROM knowledge_folders WHERE name = ? AND parent_id = ?",
                (part, current_parent)
            )
        row = await cursor.fetchone()
        if not row:
            return "NOT_FOUND"
        current_parent = row["id"]
    return current_parent


async def get_folder_path(db, folder_id):
    if not folder_id:
        return "/"
    parts = []
    current = folder_id
    depth = 0
    while current and depth < 50:
        cursor = await db.execute("SELECT name, parent_id FROM knowledge_folders WHERE id = ?", (current,))
        row = await cursor.fetchone()
        if not row:
            break
        parts.insert(0, row["name"])
        current = row["parent_id"]
        depth += 1
    return "/" + "/".join(parts)


async def execute_tool(tool_name: str, arguments, user_id: str, db) -> str:
    if not isinstance(arguments, dict):
        arguments = {}
    try:
        if tool_name == "kb_list_contents":
            return await _list_contents(arguments, db)
        elif tool_name == "kb_create_folder":
            return await _create_folder(arguments, user_id, db)
        elif tool_name == "kb_delete_folder":
            return await _delete_folder(arguments, db)
        elif tool_name == "kb_rename_folder":
            return await _rename_folder(arguments, db)
        elif tool_name == "kb_create_document":
            return await _create_document(arguments, user_id, db)
        elif tool_name == "kb_edit_document":
            return await _edit_document(arguments, db)
        elif tool_name == "kb_delete_document":
            return await _delete_document(arguments, db)
        elif tool_name == "kb_move_document":
            return await _move_document(arguments, db)
        elif tool_name == "kb_read_document":
            return await _read_document(arguments, db)
        elif tool_name == "kb_search_documents":
            return await _search_documents(arguments, db)
        elif tool_name == "kb_semantic_search":
            return await _semantic_search(arguments)
        elif tool_name == "kb_analyze_document":
            return await _analyze_document(arguments)
        elif tool_name == "kb_summarize_document":
            return await _summarize_document(arguments)
        else:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})
    except Exception as e:
        return json.dumps({"error": str(e)})


async def _list_contents(args: dict, db) -> str:
    path = args.get("path", "/")
    parent_id = await resolve_folder_path(db, path)
    if parent_id == "NOT_FOUND":
        return json.dumps({"error": f"Путь '{path}' не найден"})

    if parent_id is None:
        cursor = await db.execute("SELECT name FROM knowledge_folders WHERE parent_id IS NULL ORDER BY name")
    else:
        cursor = await db.execute("SELECT name FROM knowledge_folders WHERE parent_id = ? ORDER BY name", (parent_id,))
    folders = [row["name"] for row in await cursor.fetchall()]

    if parent_id is None:
        cursor = await db.execute(
            "SELECT filename, file_size, file_type FROM knowledge_documents WHERE folder_id IS NULL ORDER BY filename"
        )
    else:
        cursor = await db.execute(
            "SELECT filename, file_size, file_type FROM knowledge_documents WHERE folder_id = ? ORDER BY filename",
            (parent_id,)
        )
    documents = []
    for row in await cursor.fetchall():
        documents.append({
            "name": row["filename"],
            "size": row["file_size"],
            "type": row["file_type"],
        })

    return json.dumps({"path": path, "folders": folders, "documents": documents})


async def _create_folder(args: dict, user_id: str, db) -> str:
    name = args.get("name", "")
    parent_path = args.get("parent_path", "/")

    if not name:
        return json.dumps({"error": "Имя папки не указано"})

    parent_id = await resolve_folder_path(db, parent_path)
    if parent_id == "NOT_FOUND":
        return json.dumps({"error": f"Родительский путь '{parent_path}' не найден"})

    if parent_id is None:
        cursor = await db.execute("SELECT id FROM knowledge_folders WHERE name = ? AND parent_id IS NULL", (name,))
    else:
        cursor = await db.execute("SELECT id FROM knowledge_folders WHERE name = ? AND parent_id = ?", (name, parent_id))
    if await cursor.fetchone():
        return json.dumps({"error": f"Папка '{name}' уже существует в '{parent_path}'"})

    folder_id = str(uuid.uuid4())
    now = _now_iso()
    await db.execute(
        "INSERT INTO knowledge_folders (id, name, parent_id, created_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (folder_id, name, parent_id, user_id, now, now)
    )
    await db.commit()

    full_path = f"{parent_path.rstrip('/')}/{name}"
    return json.dumps({"success": True, "message": f"Папка '{name}' создана", "path": full_path})


async def _delete_folder(args: dict, db) -> str:
    path = args.get("path", "")
    if not path or path == "/":
        return json.dumps({"error": "Нельзя удалить корневую папку"})

    folder_id = await resolve_folder_path(db, path)
    if folder_id == "NOT_FOUND" or folder_id is None:
        return json.dumps({"error": f"Папка '{path}' не найдена"})

    all_ids = [folder_id]
    queue = [folder_id]
    while queue:
        current = queue.pop(0)
        cursor = await db.execute("SELECT id FROM knowledge_folders WHERE parent_id = ?", (current,))
        for child in await cursor.fetchall():
            all_ids.append(child["id"])
            queue.append(child["id"])

    placeholders = ",".join("?" for _ in all_ids)
    await db.execute(f"DELETE FROM knowledge_documents WHERE folder_id IN ({placeholders})", all_ids)
    await db.execute(f"DELETE FROM knowledge_folders WHERE id IN ({placeholders})", all_ids)
    await db.commit()

    return json.dumps({"success": True, "message": f"Папка '{path}' и всё содержимое удалены"})


async def _rename_folder(args: dict, db) -> str:
    path = args.get("path", "")
    new_name = args.get("new_name", "")

    if not path or path == "/":
        return json.dumps({"error": "Нельзя переименовать корневую папку"})
    if not new_name:
        return json.dumps({"error": "Новое имя не указано"})

    folder_id = await resolve_folder_path(db, path)
    if folder_id == "NOT_FOUND" or folder_id is None:
        return json.dumps({"error": f"Папка '{path}' не найдена"})

    await db.execute(
        "UPDATE knowledge_folders SET name = ?, updated_at = ? WHERE id = ?",
        (new_name, _now_iso(), folder_id)
    )
    await db.commit()

    return json.dumps({"success": True, "message": f"Папка переименована в '{new_name}'"})


async def _create_document(args: dict, user_id: str, db) -> str:
    filename = args.get("filename", "")
    content = args.get("content", "")
    folder_path = args.get("folder_path", "/")

    if not filename:
        return json.dumps({"error": "Имя файла не указано"})

    folder_id = await resolve_folder_path(db, folder_path)
    if folder_id == "NOT_FOUND":
        return json.dumps({"error": f"Путь '{folder_path}' не найден"})

    # Data Shield: обезличивание
    from data_shield import anonymize_text, store_vault_entries
    anonymized_content, vault_entries = anonymize_text(content)

    doc_id = str(uuid.uuid4())
    ext = "." + filename.split(".")[-1].lower() if "." in filename else ".txt"
    now = _now_iso()

    await db.execute(
        """INSERT INTO knowledge_documents
           (id, filename, file_type, file_size, content, folder_id, uploaded_by_id, uploaded_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (doc_id, filename, ext, len(content.encode("utf-8")), anonymized_content, folder_id, user_id, "AI", now, now)
    )

    if vault_entries:
        await store_vault_entries(db, doc_id, vault_entries)

    await db.commit()

    full_path = f"{folder_path.rstrip('/')}/{filename}"
    return json.dumps({"success": True, "message": f"Документ '{filename}' создан", "path": full_path})


async def _edit_document(args: dict, db) -> str:
    filename = args.get("filename", "")
    new_content = args.get("new_content", "")
    folder_path = args.get("folder_path", None)

    if not filename:
        return json.dumps({"error": "Имя файла не указано"})

    if folder_path:
        folder_id = await resolve_folder_path(db, folder_path)
        if folder_id == "NOT_FOUND":
            return json.dumps({"error": f"Путь '{folder_path}' не найден"})
        if folder_id is None:
            cursor = await db.execute(
                "SELECT id FROM knowledge_documents WHERE filename = ? AND folder_id IS NULL", (filename,)
            )
        else:
            cursor = await db.execute(
                "SELECT id FROM knowledge_documents WHERE filename = ? AND folder_id = ?", (filename, folder_id)
            )
    else:
        cursor = await db.execute("SELECT id FROM knowledge_documents WHERE filename = ?", (filename,))

    row = await cursor.fetchone()
    if not row:
        return json.dumps({"error": f"Документ '{filename}' не найден"})

    # Data Shield: обезличивание нового контента
    from data_shield import anonymize_text, store_vault_entries
    anonymized_content, vault_entries = anonymize_text(new_content)

    if vault_entries:
        await store_vault_entries(db, row["id"], vault_entries)

    await db.execute(
        "UPDATE knowledge_documents SET content = ?, file_size = ?, updated_at = ? WHERE id = ?",
        (anonymized_content, len(new_content.encode("utf-8")), _now_iso(), row["id"])
    )
    await db.commit()

    return json.dumps({"success": True, "message": f"Документ '{filename}' обновлён"})


async def _delete_document(args: dict, db) -> str:
    filename = args.get("filename", "")

    if not filename:
        return json.dumps({"error": "Имя файла не указано"})

    cursor = await db.execute("SELECT id FROM knowledge_documents WHERE filename = ?", (filename,))
    row = await cursor.fetchone()
    if not row:
        return json.dumps({"error": f"Документ '{filename}' не найден"})

    await db.execute("DELETE FROM knowledge_documents WHERE id = ?", (row["id"],))
    await db.commit()

    return json.dumps({"success": True, "message": f"Документ '{filename}' удалён"})


async def _move_document(args: dict, db) -> str:
    filename = args.get("filename", "")
    destination_path = args.get("destination_path", "/")

    if not filename:
        return json.dumps({"error": "Имя файла не указано"})

    cursor = await db.execute("SELECT id FROM knowledge_documents WHERE filename = ?", (filename,))
    row = await cursor.fetchone()
    if not row:
        return json.dumps({"error": f"Документ '{filename}' не найден"})

    dest_folder_id = await resolve_folder_path(db, destination_path)
    if dest_folder_id == "NOT_FOUND":
        return json.dumps({"error": f"Путь назначения '{destination_path}' не найден"})

    await db.execute(
        "UPDATE knowledge_documents SET folder_id = ?, updated_at = ? WHERE id = ?",
        (dest_folder_id, _now_iso(), row["id"])
    )
    await db.commit()

    return json.dumps({"success": True, "message": f"Документ '{filename}' перемещён в '{destination_path}'"})


async def _read_document(args: dict, db) -> str:
    filename = args.get("filename", "")
    folder_path = args.get("folder_path", None)

    if not filename:
        return json.dumps({"error": "Имя файла не указано"})

    if folder_path:
        folder_id = await resolve_folder_path(db, folder_path)
        if folder_id == "NOT_FOUND":
            return json.dumps({"error": f"Путь '{folder_path}' не найден"})
        if folder_id is None:
            cursor = await db.execute(
                "SELECT id, filename, content, file_type, file_size, folder_id FROM knowledge_documents WHERE filename = ? AND folder_id IS NULL",
                (filename,)
            )
        else:
            cursor = await db.execute(
                "SELECT id, filename, content, file_type, file_size, folder_id FROM knowledge_documents WHERE filename = ? AND folder_id = ?",
                (filename, folder_id)
            )
    else:
        cursor = await db.execute(
            "SELECT id, filename, content, file_type, file_size, folder_id FROM knowledge_documents WHERE filename = ?",
            (filename,)
        )

    row = await cursor.fetchone()
    if not row:
        return json.dumps({"error": f"Документ '{filename}' не найден"})

    doc_path = await get_folder_path(db, row["folder_id"])
    full_path = f"{doc_path.rstrip('/')}/{row['filename']}"

    content = row["content"] or ""

    # Data Shield: деанонимизация для авторизованного пользователя
    from data_shield import deanonymize_document
    content = await deanonymize_document(db, row["id"], content)

    max_len = 120000
    truncated = len(content) > max_len
    if truncated:
        content = content[:max_len]

    return json.dumps({
        "filename": row["filename"],
        "path": full_path,
        "file_type": row["file_type"],
        "file_size": row["file_size"],
        "content": content,
        "truncated": truncated,
    })


async def _search_documents(args: dict, db) -> str:
    query = args.get("query", "")
    if not query:
        return json.dumps({"error": "Поисковый запрос не указан"})

    search_term = f"%{query}%"
    cursor = await db.execute(
        """SELECT id, filename, file_type, file_size, folder_id,
                  SUBSTR(content, 1, 200) as preview
           FROM knowledge_documents
           WHERE filename LIKE ? OR content LIKE ?
           ORDER BY filename
           LIMIT 20""",
        (search_term, search_term)
    )
    rows = await cursor.fetchall()

    # Data Shield: деанонимизация превью для авторизованного пользователя
    from data_shield import deanonymize_document

    results = []
    for row in rows:
        doc_path = await get_folder_path(db, row["folder_id"])
        full_path = f"{doc_path.rstrip('/')}/{row['filename']}"
        preview = row["preview"] or ""
        if preview:
            preview = await deanonymize_document(db, row["id"], preview)
        results.append({
            "filename": row["filename"],
            "path": full_path,
            "file_type": row["file_type"],
            "file_size": row["file_size"],
            "preview": preview,
        })

    return json.dumps({"query": query, "count": len(results), "results": results})


KB_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "kb_list_contents",
            "description": "Показать содержимое папки в базе знаний (папки и документы с размерами)",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Путь к папке, например '/Маркетинг/Отчёты'. Используй '/' для корня."}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "kb_create_folder",
            "description": "Создать новую папку в базе знаний",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Название папки"},
                    "parent_path": {"type": "string", "description": "Путь родительской папки. '/' для корня."}
                },
                "required": ["name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "kb_rename_folder",
            "description": "Переименовать существующую папку в базе знаний",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Полный путь к папке, например '/documents'"},
                    "new_name": {"type": "string", "description": "Новое название папки"}
                },
                "required": ["path", "new_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "kb_delete_folder",
            "description": "Удалить папку и всё её содержимое из базы знаний",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Полный путь папки для удаления"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "kb_create_document",
            "description": "Создать новый текстовый документ в базе знаний",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string", "description": "Имя файла (например 'отчёт.txt')"},
                    "content": {"type": "string", "description": "Текстовое содержимое документа"},
                    "folder_path": {"type": "string", "description": "Путь папки для размещения. '/' для корня."}
                },
                "required": ["filename", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "kb_edit_document",
            "description": "Редактировать содержимое существующего документа в базе знаний",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string", "description": "Имя файла для редактирования"},
                    "new_content": {"type": "string", "description": "Новое содержимое документа"},
                    "folder_path": {"type": "string", "description": "Путь к папке с файлом (опционально)"}
                },
                "required": ["filename", "new_content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "kb_delete_document",
            "description": "Удалить документ из базы знаний",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string", "description": "Имя файла для удаления"}
                },
                "required": ["filename"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "kb_move_document",
            "description": "Переместить документ в другую папку базы знаний",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string", "description": "Имя файла для перемещения"},
                    "destination_path": {"type": "string", "description": "Путь папки назначения. '/' для корня."}
                },
                "required": ["filename", "destination_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "kb_read_document",
            "description": "Прочитать содержимое документа из базы знаний. Используй для анализа, сравнения и работы с файлами.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string", "description": "Имя файла для чтения"},
                    "folder_path": {"type": "string", "description": "Путь к папке с файлом (опционально, если не указан — поиск по всей базе)"}
                },
                "required": ["filename"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "kb_search_documents",
            "description": "Поиск документов по имени файла или содержимому. Возвращает список найденных файлов с путями и превью.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Поисковый запрос (ищет по имени файла и содержимому)"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "kb_semantic_search",
            "description": "Семантический поиск по базе знаний. Находит документы по смыслу, а не по точному совпадению слов. "
                           "Используй когда нужно найти документы по теме или смыслу запроса.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Поисковый запрос на естественном языке"},
                    "top_k": {"type": "integer", "description": "Количество результатов (по умолчанию 5)"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "kb_analyze_document",
            "description": "Анализ документа: определение типа (договор, счёт, акт и т.д.), извлечение ключевых сущностей "
                           "(даты, суммы, организации, ИНН), генерация краткого резюме.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string", "description": "Имя файла для анализа"},
                    "folder_path": {"type": "string", "description": "Путь к папке с файлом (опционально)"}
                },
                "required": ["filename"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "kb_summarize_document",
            "description": "Создать краткое резюме документа (3-5 предложений с ключевыми фактами).",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string", "description": "Имя файла для создания резюме"},
                    "folder_path": {"type": "string", "description": "Путь к папке с файлом (опционально)"}
                },
                "required": ["filename"]
            }
        }
    }
]


async def _semantic_search(args: dict) -> str:
    query = args.get("query", "")
    top_k = args.get("top_k", 5)

    if not query:
        return json.dumps({"error": "Поисковый запрос не указан"})

    try:
        from rag_engine import hybrid_search
        from data_shield import deanonymize_document
        import aiosqlite
        from config import DB_PATH

        results = await hybrid_search(query, top_k=top_k)

        formatted = []
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            for r in results:
                # Data Shield: деанонимизация превью
                content = await deanonymize_document(db, r["document_id"], r["content"])
                formatted.append({
                    "filename": r["filename"],
                    "score": r["score"],
                    "match_type": r.get("match_type", "unknown"),
                    "preview": content[:300],
                })

        return json.dumps({
            "query": query,
            "count": len(formatted),
            "results": formatted,
        }, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": f"Ошибка семантического поиска: {str(e)}"})


async def _analyze_document(args: dict) -> str:
    filename = args.get("filename", "")
    folder_path = args.get("folder_path", None)

    if not filename:
        return json.dumps({"error": "Имя файла не указано"})

    try:
        import aiosqlite
        from config import DB_PATH
        from analytics_engine import analyze_document

        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            if folder_path:
                folder_id = await resolve_folder_path(db, folder_path)
                if folder_id == "NOT_FOUND":
                    return json.dumps({"error": f"Путь '{folder_path}' не найден"})
                cursor = await db.execute(
                    "SELECT id FROM knowledge_documents WHERE filename = ? AND folder_id = ?",
                    (filename, folder_id),
                )
            else:
                cursor = await db.execute(
                    "SELECT id FROM knowledge_documents WHERE filename = ?",
                    (filename,),
                )
            row = await cursor.fetchone()
            if not row:
                return json.dumps({"error": f"Документ '{filename}' не найден"})

        result = await analyze_document(row["id"])
        simplified = {
            "filename": result.get("filename"),
            "type": result.get("classification", {}).get("type_label", "Неизвестно"),
            "summary": result.get("summary", ""),
            "entities": result.get("entities", {}),
            "stats": result.get("stats", {}),
        }
        return json.dumps(simplified, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": f"Ошибка анализа: {str(e)}"})


async def _summarize_document(args: dict) -> str:
    filename = args.get("filename", "")

    if not filename:
        return json.dumps({"error": "Имя файла не указано"})

    try:
        import aiosqlite
        from config import DB_PATH
        from analytics_engine import generate_summary

        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT id, content FROM knowledge_documents WHERE filename = ?",
                (filename,),
            )
            row = await cursor.fetchone()
            if not row:
                return json.dumps({"error": f"Документ '{filename}' не найден"})

        summary = await generate_summary(row["content"] or "")
        return json.dumps({
            "filename": filename,
            "summary": summary or "Не удалось создать резюме",
        }, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": f"Ошибка: {str(e)}"})
