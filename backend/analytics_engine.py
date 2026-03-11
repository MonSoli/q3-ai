import json
import re
import logging
from typing import List, Optional
from datetime import datetime

import httpx
import aiosqlite

from config import OLLAMA_BASE_URL, DB_PATH

logger = logging.getLogger(__name__)

DOCUMENT_TYPES = {
    "contract": "Договор",
    "invoice": "Счёт",
    "act": "Акт",
    "order": "Приказ",
    "letter": "Письмо",
    "report": "Отчёт",
    "memo": "Записка",
    "protocol": "Протокол",
    "specification": "Спецификация",
    "manual": "Инструкция",
    "policy": "Политика",
    "resume": "Резюме",
    "presentation": "Презентация",
    "other": "Другое",
}

_CLASSIFICATION_RULES = {
    "contract": [
        r"договор\b", r"контракт\b", r"соглашени", r"стороны\s+договорились",
        r"предмет\s+договора", r"права\s+и\s+обязанности", r"срок\s+действия",
    ],
    "invoice": [
        r"счёт\b", r"счет\b", r"к\s+оплате", r"итого\s+к\s+оплате",
        r"банковские\s+реквизиты", r"наименование\s+товара",
    ],
    "act": [
        r"\bакт\b", r"приёмки", r"выполненных\s+работ", r"сдачи-приёмки",
        r"акт\s+сверки",
    ],
    "order": [
        r"приказ\b", r"приказываю", r"на\s+основании", r"в\s+соответствии\s+с",
    ],
    "letter": [
        r"уважаем", r"с\s+уважением", r"просим\s+вас", r"сообщаем\s+вам",
        r"направляем\s+в\s+ваш\s+адрес",
    ],
    "report": [
        r"отчёт\b", r"отчет\b", r"за\s+период", r"результаты\s+работы",
        r"выводы\s+и\s+рекомендации",
    ],
    "protocol": [
        r"протокол\b", r"присутствовали", r"повестка\s+дня",
        r"слушали", r"решили", r"постановили",
    ],
    "memo": [
        r"служебная\s+записка", r"докладная", r"пояснительная\s+записка",
    ],
    "specification": [
        r"техническое\s+задание", r"спецификаци", r"требования\s+к",
    ],
    "manual": [
        r"инструкция", r"руководство", r"порядок\s+действий",
    ],
    "policy": [
        r"политика", r"положение\s+о", r"регламент",
    ],
    "resume": [
        r"резюме", r"curriculum\s+vitae", r"опыт\s+работы", r"образование",
        r"навыки\s+и\s+умения",
    ],
}


def classify_document_fast(content: str, filename: str = "") -> dict:
    if not content:
        return {"type": "other", "type_label": DOCUMENT_TYPES["other"], "confidence": 0.0}

    text_lower = content[:5000].lower()
    filename_lower = filename.lower()

    scores = {}
    for doc_type, patterns in _CLASSIFICATION_RULES.items():
        score = 0
        for pattern in patterns:
            matches = len(re.findall(pattern, text_lower))
            score += matches
        if doc_type in filename_lower or DOCUMENT_TYPES.get(doc_type, "").lower() in filename_lower:
            score += 3
        scores[doc_type] = score

    if not scores or max(scores.values()) == 0:
        return {"type": "other", "type_label": DOCUMENT_TYPES["other"], "confidence": 0.1}

    best_type = max(scores, key=scores.get)
    max_score = scores[best_type]
    confidence = min(max_score / 10.0, 1.0)

    return {
        "type": best_type,
        "type_label": DOCUMENT_TYPES.get(best_type, best_type),
        "confidence": round(confidence, 2),
    }


async def classify_document_ai(content: str, filename: str, model: str = "qwen3:4b") -> dict:
    preview = content[:3000] if content else ""
    types_list = ", ".join(f"{k} ({v})" for k, v in DOCUMENT_TYPES.items())

    prompt = (
        f"Классифицируй документ. Файл: {filename}\n"
        f"Типы: {types_list}\n\n"
        f"Начало документа:\n{preview}\n\n"
        "Ответь ТОЛЬКО в формате JSON: "
        '{"type": "тип", "type_label": "Название", "confidence": 0.9, '
        '"summary": "Краткое описание в 1 предложении"} /no_think'
    )

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 200, "num_ctx": 4096},
                },
            )
            if resp.status_code == 200:
                raw = resp.json().get("response", "")
                raw = re.sub(r"<think>[\s\S]*?</think>", "", raw).strip()
                match = re.search(r'\{[^}]+\}', raw)
                if match:
                    result = json.loads(match.group())
                    if "type" in result:
                        return result
    except Exception as e:
        logger.warning("AI classification failed: %s", e)

    return classify_document_fast(content, filename)


_DATE_PATTERNS = [
    r'\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b',
    r'\b(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})\b',
]

_MONEY_PATTERNS = [
    r'(\d[\d\s]*[\d,.]+)\s*(руб|рублей|₽|RUB|USD|\$|EUR|€)',
    r'(сумма|стоимость|цена|итого|всего)[:\s]+(\d[\d\s,.]*\d)\s*(руб|₽|RUB)?',
]

_ORG_PATTERNS = [
    r'(ООО|ОАО|ЗАО|ПАО|АО|ИП|ФГУП|МУП|НКО)\s*[«"]([^»"]+)[»"]',
    r'(ООО|ОАО|ЗАО|ПАО|АО|ИП)\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)*)',
]

_INN_PATTERN = r'ИНН[:\s]*(\d{10,12})'
_OGRN_PATTERN = r'ОГРН[:\s]*(\d{13,15})'
_PHONE_PATTERN = r'(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}'
_EMAIL_PATTERN = r'[\w.+-]+@[\w-]+\.[\w.-]+'

MONTHS_RU = {
    "января": 1, "февраля": 2, "марта": 3, "апреля": 4,
    "мая": 5, "июня": 6, "июля": 7, "августа": 8,
    "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
}


def extract_entities(content: str) -> dict:
    if not content:
        return {}

    entities = {
        "dates": [],
        "amounts": [],
        "organizations": [],
        "inn": [],
        "ogrn": [],
        "phones": [],
        "emails": [],
    }

    for pattern in _DATE_PATTERNS:
        for match in re.finditer(pattern, content, re.IGNORECASE):
            entities["dates"].append(match.group())

    for pattern in _MONEY_PATTERNS:
        for match in re.finditer(pattern, content, re.IGNORECASE):
            entities["amounts"].append(match.group().strip())

    for pattern in _ORG_PATTERNS:
        for match in re.finditer(pattern, content):
            org = match.group().strip()
            if org not in entities["organizations"]:
                entities["organizations"].append(org)

    for match in re.finditer(_INN_PATTERN, content):
        entities["inn"].append(match.group(1))

    for match in re.finditer(_OGRN_PATTERN, content):
        entities["ogrn"].append(match.group(1))

    for match in re.finditer(_PHONE_PATTERN, content):
        entities["phones"].append(match.group().strip())

    for match in re.finditer(_EMAIL_PATTERN, content):
        entities["emails"].append(match.group())

    for key in entities:
        entities[key] = list(dict.fromkeys(entities[key]))

    return entities


def extract_deadlines(content: str) -> List[dict]:
    deadlines = []
    deadline_keywords = [
        r'(срок|до|не\s+позднее|крайний\s+срок|дедлайн|deadline)',
    ]

    for keyword_pattern in deadline_keywords:
        for date_pattern in _DATE_PATTERNS:
            combined = keyword_pattern + r'[:\s]*' + date_pattern
            for match in re.finditer(combined, content, re.IGNORECASE):
                deadlines.append({
                    "context": match.group().strip(),
                    "date_raw": match.group(),
                })

    return deadlines


async def generate_summary(content: str, model: str = "qwen3:4b") -> Optional[str]:
    if not content or len(content) < 50:
        return None

    preview = content[:6000]
    prompt = (
        "Сделай краткое резюме документа (3-5 предложений). "
        "Выдели ключевые факты, даты, суммы и стороны. "
        "Отвечай только резюме, без вступлений.\n\n"
        f"Документ:\n{preview} /no_think"
    )

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.3, "num_predict": 500, "num_ctx": 8192},
                },
            )
            if resp.status_code == 200:
                raw = resp.json().get("response", "")
                summary = re.sub(r"<think>[\s\S]*?</think>", "", raw).strip()
                return summary if summary else None
    except Exception as e:
        logger.warning("Summary generation failed: %s", e)

    return None


async def analyze_document(doc_id: str, model: str = "qwen3:4b") -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, filename, content FROM knowledge_documents WHERE id = ?",
            (doc_id,),
        )
        doc = await cursor.fetchone()
        if not doc:
            return {"error": "Document not found"}

    content = doc["content"] or ""
    filename = doc["filename"]

    classification = classify_document_fast(content, filename)
    entities = extract_entities(content)
    deadlines = extract_deadlines(content)

    ai_class = await classify_document_ai(content, filename, model)
    if ai_class.get("confidence", 0) > classification.get("confidence", 0):
        classification = ai_class

    summary = await generate_summary(content, model)

    word_count = len(content.split())
    char_count = len(content)
    paragraph_count = len([p for p in content.split("\n\n") if p.strip()])

    result = {
        "document_id": doc_id,
        "filename": filename,
        "classification": classification,
        "entities": entities,
        "deadlines": deadlines,
        "summary": summary,
        "stats": {
            "word_count": word_count,
            "char_count": char_count,
            "paragraph_count": paragraph_count,
        },
    }

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        await db.execute(
            """UPDATE knowledge_documents
               SET doc_type = ?, doc_type_label = ?, doc_summary = ?,
                   entities_json = ?, analyzed_at = datetime('now')
               WHERE id = ?""",
            (
                classification.get("type", "other"),
                classification.get("type_label", "Другое"),
                summary,
                json.dumps(entities, ensure_ascii=False),
                doc_id,
            ),
        )

        await db.execute("DELETE FROM document_tags WHERE document_id = ?", (doc_id,))
        tags = set()
        tags.add(classification.get("type_label", "Другое"))
        for org in entities.get("organizations", [])[:5]:
            tags.add(org)
        for tag in tags:
            import uuid
            await db.execute(
                "INSERT INTO document_tags (id, document_id, tag, tag_type) VALUES (?, ?, ?, ?)",
                (str(uuid.uuid4()), doc_id, tag, "auto"),
            )

        await db.commit()

    return result


async def get_analytics_dashboard() -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        cursor = await db.execute("SELECT COUNT(*) as cnt FROM knowledge_documents")
        total = (await cursor.fetchone())["cnt"]

        cursor = await db.execute(
            """SELECT doc_type, doc_type_label, COUNT(*) as cnt
               FROM knowledge_documents
               WHERE doc_type IS NOT NULL
               GROUP BY doc_type ORDER BY cnt DESC"""
        )
        by_type = [dict(row) for row in await cursor.fetchall()]

        cursor = await db.execute(
            """SELECT id, filename, doc_type_label, doc_summary, created_at
               FROM knowledge_documents
               ORDER BY created_at DESC LIMIT 10"""
        )
        recent = [dict(row) for row in await cursor.fetchall()]

        cursor = await db.execute(
            """SELECT tag, COUNT(*) as cnt
               FROM document_tags
               GROUP BY tag ORDER BY cnt DESC LIMIT 20"""
        )
        top_tags = [dict(row) for row in await cursor.fetchall()]

        cursor = await db.execute("SELECT COUNT(*) as cnt FROM document_chunks")
        total_chunks = (await cursor.fetchone())["cnt"]

        cursor = await db.execute(
            "SELECT id, filename, entities_json FROM knowledge_documents WHERE entities_json IS NOT NULL"
        )
        docs_with_entities = await cursor.fetchall()

        all_orgs = {}
        for doc in docs_with_entities:
            try:
                ent = json.loads(doc["entities_json"])
                for org in ent.get("organizations", []):
                    all_orgs[org] = all_orgs.get(org, 0) + 1
            except (json.JSONDecodeError, TypeError):
                pass

        top_orgs = sorted(all_orgs.items(), key=lambda x: x[1], reverse=True)[:10]

    return {
        "total_documents": total,
        "total_chunks": total_chunks,
        "by_type": by_type,
        "recent_documents": recent,
        "top_tags": top_tags,
        "top_organizations": [{"name": o[0], "count": o[1]} for o in top_orgs],
    }
