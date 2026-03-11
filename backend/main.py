import json
import re
import uuid
import asyncio
import logging
import traceback
from contextlib import asynccontextmanager

import aiosqlite
import httpx
from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from config import OLLAMA_BASE_URL, DB_PATH, CORS_ORIGINS, RATE_LIMIT_DEFAULT, RATE_LIMIT_LOGIN
from database import init_db
from auth import get_current_user, get_optional_user
from routers.auth_router import router as auth_router
from routers.chats_router import router as chats_router
from routers.settings_router import router as settings_router
from routers.documents_router import router as documents_router
from routers.migration_router import router as migration_router
from routers.admin_router import router as admin_router
from routers.knowledge_router import router as knowledge_router
from routers.backup_router import router as backup_router
from routers.rag_router import router as rag_router
from routers.analytics_router import router as analytics_router
from routers.notifications_router import router as notifications_router
from tool_executor import KB_TOOLS, execute_tool
from rag_engine import get_rag_context

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_tool_text_re = re.compile(
    r'kb_(?:list_contents|create_folder|rename_folder|delete_folder|'
    r'create_document|edit_document|delete_document|move_document|'
    r'read_document|search_documents|semantic_search|analyze_document|'
    r'summarize_document)\s*\([^)]*\)\s*',
)

limiter = Limiter(key_func=get_remote_address)

ollama_client: httpx.AsyncClient = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global ollama_client
    await init_db()
    ollama_client = httpx.AsyncClient(
        timeout=httpx.Timeout(None, connect=10.0),
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        http2=False,
    )
    yield
    await ollama_client.aclose()


app = FastAPI(title="Qwen3 Web UI Backend", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth_router)
app.include_router(chats_router)
app.include_router(settings_router)
app.include_router(documents_router)
app.include_router(migration_router)
app.include_router(admin_router)
app.include_router(knowledge_router)
app.include_router(backup_router)
app.include_router(rag_router)
app.include_router(analytics_router)
app.include_router(notifications_router)


@app.get("/api/models")
async def list_models():
    try:
        resp = await ollama_client.get(f"{OLLAMA_BASE_URL}/api/tags")
        resp.raise_for_status()
        data = resp.json()
        models = [m["name"] for m in data.get("models", [])]
        return {"models": models}
    except httpx.ConnectError:
        return {"models": [], "error": "Ollama is not running"}
    except Exception as e:
        return {"models": [], "error": str(e)}


@app.post("/api/chat")
async def chat(request: Request, user=Depends(get_current_user)):
    body = await request.json()
    messages = body.get("messages", [])
    model = body.get("model", "qwen3:4b")
    temperature = body.get("temperature", 0.7)
    thinking = body.get("thinking", True)
    num_ctx = body.get("num_ctx", 4096)
    chat_id = body.get("chat_id")
    use_knowledge = body.get("use_knowledge", True)

    use_tools = False
    rag_context = ""
    if use_knowledge and user:
        try:
            async with aiosqlite.connect(DB_PATH) as db:
                cursor = await db.execute(
                    "SELECT "
                    "(SELECT COUNT(*) FROM knowledge_documents) AS dc, "
                    "(SELECT COUNT(*) FROM knowledge_folders) AS fc"
                )
                row = await cursor.fetchone()
                doc_count, folder_count = row[0], row[1]

                if doc_count > 0 or folder_count > 0:
                    user_query = ""
                    for m in reversed(messages):
                        if m.get("role") == "user":
                            user_query = m.get("content", "")
                            break
                    if user_query:
                        try:
                            rag_context = await get_rag_context(user_query, max_tokens=8000)
                        except Exception as e:
                            logger.warning("RAG context failed: %s", e)

                    rag_section = ""
                    if rag_context:
                        rag_section = (
                            "\n\nРелевантный контекст из базы знаний (используй для ответа если подходит):\n"
                            + rag_context
                        )

                    system_msg = {
                        "role": "system",
                        "content": (
                            "У тебя есть доступ к базе знаний компании "
                            f"({doc_count} документов, {folder_count} папок). "
                            "Используй инструменты ТОЛЬКО когда пользователь явно просит работать с базой знаний, "
                            "документами или папками. Если вопрос не связан с базой знаний — просто отвечай как обычно, "
                            "НЕ упоминая инструменты и НЕ пытаясь их вызвать. "
                            "НИКОГДА не пиши названия инструментов в тексте ответа. "
                            "Выполняй операции по одной за раз, дожидаясь результата каждой. "
                            "Когда пользователь просит СРАВНИТЬ документы — сначала используй kb_list_contents "
                            "чтобы найти нужные файлы, затем используй kb_read_document для КАЖДОГО файла по очереди, "
                            "и после прочтения ВСЕХ документов дай подробное сравнение."
                            + rag_section
                        ),
                    }
                    messages = [system_msg] + messages
                    use_tools = True
        except Exception as e:
            logger.warning("Failed to build KB context: %s", e)

    collected_response = []

    async def _call_ollama_with_tools(payload):
        try:
            resp = await ollama_client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json=payload,
                timeout=None,
            )
            data = resp.json() if resp.text else None
            if not isinstance(data, dict):
                return None, f"Unexpected Ollama response: {resp.text[:200]}"
            if resp.status_code != 200:
                error_text = data.get("error", resp.text) or resp.text
                return None, error_text
            msg = data.get("message")
            if not isinstance(msg, dict):
                return {}, None
            return msg, None
        except Exception as e:
            err = str(e) or type(e).__name__ or "Unknown error"
            logger.warning("Ollama request failed [%s]: %s", type(e).__name__, err)
            return None, err

    async def generate():
        nonlocal messages

        if use_tools:
            tool_num_ctx = max(num_ctx, 4096)

            tool_messages = []
            for idx, msg in enumerate(messages):
                if msg["role"] == "user" and idx == len(messages) - 1:
                    tool_messages.append({**msg, "content": msg["content"] + " /no_think"})
                else:
                    tool_messages.append(msg)

            max_tool_rounds = 15
            for round_num in range(max_tool_rounds):
                try:
                    yield f"data: {json.dumps({'status': 'thinking', 'round': round_num + 1})}\n\n"

                    tool_payload = {
                        "model": model,
                        "messages": tool_messages,
                        "stream": False,
                        "keep_alive": "30m",
                        "tools": KB_TOOLS,
                        "options": {
                            "temperature": temperature,
                            "num_ctx": tool_num_ctx,
                            "num_predict": 8192,
                            "num_batch": 512,
                        },
                    }

                    assistant_msg = None
                    error = None
                    for attempt in range(2):
                        task = asyncio.create_task(_call_ollama_with_tools(tool_payload))
                        while not task.done():
                            yield f"data: {json.dumps({'status': 'working'})}\n\n"
                            await asyncio.sleep(2)

                        assistant_msg, error = task.result()
                        logger.info("Tool round %d attempt %d: error=%s, type=%s, has_tool_calls=%s",
                                    round_num + 1, attempt + 1,
                                    repr(error), type(assistant_msg).__name__,
                                    bool(isinstance(assistant_msg, dict) and assistant_msg.get("tool_calls")))

                        if error is None:
                            break
                        logger.warning("Round %d attempt %d failed: %s, retrying...", round_num + 1, attempt + 1, error)
                        await asyncio.sleep(1)

                    if error is not None:
                        error_token = f"Ошибка Ollama: {error}"
                        collected_response.append(error_token)
                        yield f"data: {json.dumps({'token': error_token, 'done': True})}\n\n"
                        await _save_response(user, chat_id, collected_response)
                        return

                    if not isinstance(assistant_msg, dict):
                        assistant_msg = {}

                    tool_calls = assistant_msg.get("tool_calls") or []
                    if not isinstance(tool_calls, list):
                        tool_calls = []

                    if not tool_calls:
                        break

                    for tc in tool_calls:
                        if not isinstance(tc, dict):
                            continue
                        fn = tc.get("function")
                        if not isinstance(fn, dict):
                            continue
                        fn_name = fn.get("name", "unknown")
                        yield f"data: {json.dumps({'status': 'tool_call', 'tool': fn_name})}\n\n"

                    tool_messages.append(assistant_msg)
                    messages.append(assistant_msg)
                    async with aiosqlite.connect(DB_PATH) as db:
                        db.row_factory = aiosqlite.Row
                        for tc in tool_calls:
                            if not isinstance(tc, dict):
                                continue
                            fn = tc.get("function")
                            if not isinstance(fn, dict):
                                continue
                            fn_name = fn.get("name", "")
                            fn_args = fn.get("arguments")
                            if isinstance(fn_args, str):
                                try:
                                    fn_args = json.loads(fn_args)
                                except (json.JSONDecodeError, TypeError):
                                    fn_args = {}
                            if not isinstance(fn_args, dict):
                                fn_args = {}
                            result_str = await execute_tool(fn_name, fn_args, user["id"], db)
                            logger.info("Tool %s result (%d chars): %s", fn_name, len(result_str), result_str[:200])

                            full_tool_result = {"role": "tool", "content": result_str}
                            messages.append(full_tool_result)

                            if len(result_str) > 15000:
                                try:
                                    parsed = json.loads(result_str)
                                    if isinstance(parsed, dict) and "content" in parsed:
                                        parsed["content"] = parsed["content"][:12000] + "... [обрезано]"
                                        parsed["truncated"] = True
                                    truncated_str = json.dumps(parsed, ensure_ascii=False)
                                except (json.JSONDecodeError, TypeError):
                                    truncated_str = result_str[:15000] + "... [обрезано]"
                                logger.warning("Tool %s result truncated for tool loop (was %d chars)", fn_name, len(result_str))
                                tool_messages.append({"role": "tool", "content": truncated_str})
                            else:
                                tool_messages.append(full_tool_result)

                except Exception as e:
                    err_msg = str(e) or type(e).__name__
                    logger.error("Tool execution error: %s\n%s", e, traceback.format_exc())
                    error_token = f"Ошибка инструмента: {err_msg}"
                    collected_response.append(error_token)
                    yield f"data: {json.dumps({'token': error_token, 'done': True})}\n\n"
                    await _save_response(user, chat_id, collected_response)
                    return

        final_messages = []
        tool_results = []
        doc_contents = []
        for msg in messages:
            role = msg.get("role", "")
            if role == "assistant" and msg.get("tool_calls"):
                continue
            elif role == "tool":
                try:
                    result = json.loads(msg.get("content", "{}"))
                    if result.get("content") is not None and result.get("filename"):
                        fname = result["filename"]
                        content = result["content"]
                        truncated = result.get("truncated", False)
                        doc_contents.append(
                            f'========== ДОКУМЕНТ: "{fname}" ==========\n'
                            f'{content}\n'
                            f'========== КОНЕЦ ДОКУМЕНТА: "{fname}" =========='
                            + (" [документ обрезан]" if truncated else "")
                        )
                    elif result.get("success"):
                        tool_results.append(result.get("message", ""))
                    elif result.get("error"):
                        tool_results.append(f"Ошибка: {result['error']}")
                    elif result.get("documents") is not None or result.get("folders") is not None:
                        path = result.get("path", "/")
                        folders = result.get("folders", [])
                        docs = result.get("documents", [])
                        summary_parts = [f"Содержимое '{path}':"]
                        for f in folders:
                            summary_parts.append(f"  [папка] {f}")
                        for d in docs:
                            name = d.get("name", d) if isinstance(d, dict) else str(d)
                            summary_parts.append(f"  [файл] {name}")
                        tool_results.append("\n".join(summary_parts))
                    else:
                        tool_results.append(json.dumps(result, ensure_ascii=False))
                except (json.JSONDecodeError, TypeError):
                    content = msg.get("content", "")
                    if content:
                        tool_results.append(content[:500])
                continue
            else:
                final_messages.append(msg)

        yield f"data: {json.dumps({'status': 'generating'})}\n\n"

        logger.info("Phase 2: %d clean messages, %d tool results, %d doc contents",
                     len(final_messages), len(tool_results), len(doc_contents))

        system_parts = []
        if doc_contents:
            docs_section = (
                f"Содержимое {len(doc_contents)} документ(ов) из базы знаний:\n\n"
                + "\n\n\n".join(doc_contents)
            )
            system_parts.append(docs_section)

        if tool_results:
            ops_section = (
                "Результаты операций с базой знаний:\n"
                + "\n".join(f"- {r}" for r in tool_results)
            )
            if len(ops_section) > 3000:
                ops_section = ops_section[:3000] + "\n... (результаты обрезаны)"
            system_parts.append(ops_section)

        if system_parts:
            summary = "\n\n".join(system_parts)
            summary += (
                "\n\nОперации выполнены. Опиши пользователю результат простым языком. "
                "НЕ упоминай названия инструментов, функций или технические детали вызовов. "
                "Если пользователь просил сравнить документы — сравни их подробно, "
                "выдели все различия и сходства в структурированном виде. "
                "ВАЖНО: Если создаёшь таблицу — ОБЯЗАТЕЛЬНО заполняй КАЖДУЮ ячейку таблицы. "
                "Ни одна ячейка не должна быть пустой. Если данные отсутствуют — пиши '—' или 'Нет данных'. "
                "Генерируй таблицу ПОЛНОСТЬЮ, не обрывай на середине."
            )
            final_messages.append({"role": "system", "content": summary})

        suffix = " /think" if thinking else " /no_think"
        for i in range(len(final_messages) - 1, -1, -1):
            if final_messages[i].get("role") == "user":
                final_messages[i] = {**final_messages[i], "content": final_messages[i]["content"] + suffix}
                break

        effective_num_ctx = num_ctx
        if doc_contents:
            total_chars = sum(len(d) for d in doc_contents)
            estimated_tokens = total_chars // 3
            needed = estimated_tokens + 16384
            effective_num_ctx = max(num_ctx, min(needed, 65536))
            logger.info("Phase 2: auto-increased num_ctx from %d to %d (doc chars: %d)",
                        num_ctx, effective_num_ctx, total_chars)

        num_predict = 16384
        if doc_contents and len(doc_contents) >= 2:
            num_predict = 32768

        stream_payload = {
            "model": model,
            "messages": final_messages,
            "stream": True,
            "keep_alive": "30m",
            "options": {
                "temperature": temperature,
                "num_ctx": effective_num_ctx,
                "num_predict": num_predict,
                "num_batch": 512,
            },
        }

        token_count = 0
        token_buffer = ""
        try:
            async with ollama_client.stream(
                "POST",
                f"{OLLAMA_BASE_URL}/api/chat",
                json=stream_payload,
                timeout=None,
            ) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    try:
                        error_text = json.loads(body).get("error", body.decode())
                    except Exception:
                        error_text = body.decode()
                    yield f"data: {json.dumps({'token': f'Ошибка Ollama: {error_text}', 'done': True})}\n\n"
                    return

                async def _flush_buffer(buf, is_done=False):
                    nonlocal token_count
                    cleaned = _tool_text_re.sub("", buf)
                    if cleaned:
                        collected_response.append(cleaned)
                        token_count += 1
                        if token_count == 1:
                            logger.info("Phase 2: first token received")
                    data = json.dumps({"token": cleaned, "done": is_done})
                    return f"data: {data}\n\n"

                async for line in resp.aiter_lines():
                    if line.strip():
                        try:
                            chunk = json.loads(line)
                            token = chunk.get("message", {}).get("content", "")
                            done = chunk.get("done", False)

                            token_buffer += token

                            if not done and "kb_" in token_buffer and len(token_buffer) < 80:
                                continue

                            yield await _flush_buffer(token_buffer, done)
                            token_buffer = ""

                            if done:
                                break
                        except json.JSONDecodeError:
                            continue

                if token_buffer:
                    yield await _flush_buffer(token_buffer, True)

        except httpx.ConnectError:
            error_token = "Ошибка: Ollama не запущена. Запустите `ollama serve`."
            collected_response.append(error_token)
            yield f"data: {json.dumps({'token': error_token, 'done': True})}\n\n"
        except Exception as e:
            err_msg = str(e) or type(e).__name__
            logger.error("Streaming error [%s]: %s\n%s", type(e).__name__, err_msg, traceback.format_exc())
            error_token = f"Ошибка стриминга: {err_msg}"
            collected_response.append(error_token)
            yield f"data: {json.dumps({'token': error_token, 'done': True})}\n\n"

        logger.info("Phase 2 done: %d tokens total", token_count)

        await _save_response(user, chat_id, collected_response)

    return StreamingResponse(generate(), media_type="text/event-stream")


async def _save_response(user, chat_id, collected_response):
    if user and chat_id and collected_response:
        try:
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute("PRAGMA foreign_keys=ON")
                full_response = "".join(collected_response)
                msg_id = str(uuid.uuid4())
                await db.execute(
                    "INSERT INTO messages (id, chat_id, role, content) VALUES (?, ?, ?, ?)",
                    (msg_id, chat_id, "assistant", full_response),
                )
                await db.execute(
                    "UPDATE chats SET updated_at = datetime('now') WHERE id = ?",
                    (chat_id,),
                )
                await db.commit()
        except Exception as e:
            logger.error("Failed to save response: %s", e)


@app.post("/api/chats/{chat_id}/generate-title")
async def generate_chat_title(chat_id: str, request: Request, user=Depends(get_current_user)):
    body = await request.json()
    message = body.get("message", "")
    model = body.get("model", "qwen3:4b")
    if not message:
        return {"title": ""}
    try:
        resp = await ollama_client.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={
                "model": model,
                "prompt": (
                    "Придумай короткое название (2-5 слов) для чата на основе сообщения пользователя. "
                    "Ответь ТОЛЬКО названием без кавычек, пояснений и знаков препинания.\n\n"
                    f"Сообщение: {message[:500]}"
                ),
                "stream": False,
                "options": {
                    "temperature": 0.5,
                    "num_predict": 30,
                    "num_ctx": 1024,
                },
            },
            timeout=30,
        )
        raw = resp.json().get("response", "").strip()
        title = re.sub(r"<think>[\s\S]*?</think>", "", raw).strip()
        title = title.strip('"\'«»""').strip().rstrip(".")
        title = title.split("\n")[0].strip()
        if not title:
            return {"title": ""}
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "UPDATE chats SET title = ? WHERE id = ? AND user_id = ?",
                (title, chat_id, user["id"]),
            )
            await db.commit()
        return {"title": title}
    except Exception as e:
        logger.warning("Title generation failed: %s", e)
        return {"title": ""}


@app.post("/api/warmup")
async def warmup(request: Request):
    body = await request.json()
    model = body.get("model", "qwen3:4b")
    try:
        await ollama_client.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={
                "model": model,
                "messages": [],
                "keep_alive": "60m",
                "options": {
                    "num_gpu": 99,
                },
            },
        )
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.get("/api/health")
async def health():
    try:
        await ollama_client.get(f"{OLLAMA_BASE_URL}/api/tags")
        return {"status": "ok", "ollama": "connected"}
    except Exception:
        return {"status": "ok", "ollama": "disconnected"}
