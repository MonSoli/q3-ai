import json
import logging
import os
import re
import uuid
from typing import Optional

from cryptography.fernet import Fernet

from config import DATA_SHIELD_KEY

logger = logging.getLogger(__name__)

_fernet = Fernet(DATA_SHIELD_KEY.encode() if isinstance(DATA_SHIELD_KEY, str) else DATA_SHIELD_KEY)


_SENSITIVE_PATTERNS = [
    # Суммы денег: "1 500 000,00 руб" / "3500.50 USD" / "сумма: 100000"
    (
        "СУММА",
        re.compile(
            r'(\d[\d\s]*[\d,.]+)\s*(?:руб(?:лей|\.)?|₽|RUB|USD|\$|EUR|€)',
            re.IGNORECASE,
        ),
    ),
    (
        "СУММА",
        re.compile(
            r'(?:сумма|стоимость|цена|итого|всего|оплата|вознаграждение)'
            r'[:\s—\-]+(\d[\d\s,.]*\d)(?:\s*(?:руб|₽|RUB|\(|р\.))?',
            re.IGNORECASE,
        ),
    ),
    # ИНН (10 или 12 цифр)
    (
        "ИНН",
        re.compile(r'ИНН[:\s]*(\d{10,12})', re.IGNORECASE),
    ),
    # ОГРН (13 или 15 цифр)
    (
        "ОГРН",
        re.compile(r'ОГРН[:\s]*(\d{13,15})', re.IGNORECASE),
    ),
    # КПП (9 цифр)
    (
        "КПП",
        re.compile(r'КПП[:\s]*(\d{9})', re.IGNORECASE),
    ),
    # Расчётный/корр. счёт (20 цифр)
    (
        "СЧЁТ",
        re.compile(r'(?:р/?с|к/?с|расч[её]тный\s+сч[её]т|корр\.?\s*сч[её]т)[:\s]*(\d{20})', re.IGNORECASE),
    ),
    # БИК (9 цифр)
    (
        "БИК",
        re.compile(r'БИК[:\s]*(\d{9})', re.IGNORECASE),
    ),
    # Организации: ООО «Рога и Копыта», АО "Газпром", ИП Иванов
    (
        "ОРГ",
        re.compile(
            r'((?:ООО|ОАО|ЗАО|ПАО|АО|ИП|ФГУП|МУП|НКО)\s*[«"]([^»"]+)[»"])',
        ),
    ),
    (
        "ОРГ",
        re.compile(
            r'((?:ООО|ОАО|ЗАО|ПАО|АО|ИП)\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){0,3})',
        ),
    ),
    # Телефоны: +7 (999) 123-45-67
    (
        "ТЕЛ",
        re.compile(r'(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}'),
    ),
    # Email
    (
        "EMAIL",
        re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+'),
    ),
    # Паспортные данные: серия и номер
    (
        "ПАСПОРТ",
        re.compile(r'(?:паспорт|серия)[:\s]*(\d{2}\s*\d{2})\s*(?:№|номер|н\.?)[:\s]*(\d{6})', re.IGNORECASE),
    ),
    # СНИЛС
    (
        "СНИЛС",
        re.compile(r'СНИЛС[:\s]*(\d{3}[\s-]*\d{3}[\s-]*\d{3}[\s-]*\d{2})', re.IGNORECASE),
    ),
    # Номер договора
    (
        "НОМЕР_ДОГ",
        re.compile(r'(?:договор|контракт|соглашение)\s*(?:№|номер|N)\s*([А-Яа-яA-Za-z0-9/\-]+)', re.IGNORECASE),
    ),
]


def _encrypt(value: str) -> str:
    return _fernet.encrypt(value.encode("utf-8")).decode("ascii")


def _decrypt(token: str) -> str:
    return _fernet.decrypt(token.encode("ascii")).decode("utf-8")


def anonymize_text(content: str) -> tuple[str, list[dict]]:
    if not content:
        return content, []

    # Собираем все совпадения с позициями
    all_matches = []

    for category, pattern in _SENSITIVE_PATTERNS:
        for match in pattern.finditer(content):
            # Берём полное совпадение (group(0))
            original_value = match.group(0).strip()
            start = match.start()
            end = match.end()

            # Пропускаем слишком короткие (< 3 символов)
            if len(original_value) < 3:
                continue

            all_matches.append({
                "category": category,
                "value": original_value,
                "start": start,
                "end": end,
            })

    if not all_matches:
        return content, []

    # Сортируем по позиции (с конца, чтобы замена не сбивала индексы)
    all_matches.sort(key=lambda m: m["start"])

    # Убираем перекрывающиеся совпадения (оставляем первое/более длинное)
    filtered = []
    last_end = -1
    for m in all_matches:
        if m["start"] >= last_end:
            filtered.append(m)
            last_end = m["end"]
        else:
            # Если текущее совпадение длиннее предыдущего — заменяем
            if filtered and m["end"] > filtered[-1]["end"]:
                filtered[-1] = m
                last_end = m["end"]

    # Нумеруем плейсхолдеры по категориям
    category_counters = {}
    vault_entries = []
    anonymized = content

    # Заменяем с конца, чтобы не сбивать позиции
    for m in reversed(filtered):
        cat = m["category"]
        if cat not in category_counters:
            # Считаем сколько всего этой категории
            count = sum(1 for x in filtered if x["category"] == cat)
            category_counters[cat] = {"total": count, "current": 0}

        category_counters[cat]["current"] += 1
        # Нумерация с 1, в порядке появления в тексте
        num = category_counters[cat]["total"] - category_counters[cat]["current"] + 1
        placeholder = f"[{cat}_{num}]"

        encrypted = _encrypt(m["value"])

        vault_entries.append({
            "placeholder": placeholder,
            "category": cat,
            "encrypted_value": encrypted,
            "original_position": m["start"],
        })

        anonymized = anonymized[:m["start"]] + placeholder + anonymized[m["end"]:]

    # Разворачиваем vault_entries в порядке появления
    vault_entries.reverse()

    return anonymized, vault_entries


def deanonymize_text(anonymized_content: str, vault_entries: list[dict]) -> str:
    if not anonymized_content or not vault_entries:
        return anonymized_content

    result = anonymized_content
    for entry in vault_entries:
        placeholder = entry["placeholder"]
        try:
            real_value = _decrypt(entry["encrypted_value"])
            result = result.replace(placeholder, real_value)
        except Exception as e:
            logger.warning("Failed to decrypt placeholder %s: %s", placeholder, e)
            # Оставляем плейсхолдер как есть
            continue

    return result


async def store_vault_entries(db, document_id: str, vault_entries: list[dict]):
    if not vault_entries:
        return

    # Удаляем старые записи для этого документа
    await db.execute("DELETE FROM sensitive_data_vault WHERE document_id = ?", (document_id,))

    for entry in vault_entries:
        entry_id = str(uuid.uuid4())
        await db.execute(
            """INSERT INTO sensitive_data_vault
               (id, document_id, placeholder, category, encrypted_value, original_position)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                entry_id,
                document_id,
                entry["placeholder"],
                entry["category"],
                entry["encrypted_value"],
                entry["original_position"],
            ),
        )


async def load_vault_entries(db, document_id: str) -> list[dict]:
    cursor = await db.execute(
        "SELECT placeholder, category, encrypted_value, original_position "
        "FROM sensitive_data_vault WHERE document_id = ? ORDER BY original_position",
        (document_id,),
    )
    rows = await cursor.fetchall()
    return [
        {
            "placeholder": row["placeholder"],
            "category": row["category"],
            "encrypted_value": row["encrypted_value"],
            "original_position": row["original_position"],
        }
        for row in rows
    ]


async def deanonymize_document(db, document_id: str, anonymized_content: str) -> str:
    entries = await load_vault_entries(db, document_id)
    if not entries:
        return anonymized_content
    return deanonymize_text(anonymized_content, entries)


async def get_shield_stats(db) -> dict:
    cursor = await db.execute("SELECT COUNT(DISTINCT document_id) as doc_count FROM sensitive_data_vault")
    row = await cursor.fetchone()
    protected_docs = row["doc_count"] if row else 0

    cursor = await db.execute(
        "SELECT category, COUNT(*) as cnt FROM sensitive_data_vault GROUP BY category ORDER BY cnt DESC"
    )
    by_category = [{"category": r["category"], "count": r["cnt"]} for r in await cursor.fetchall()]

    cursor = await db.execute("SELECT COUNT(*) as total FROM sensitive_data_vault")
    row = await cursor.fetchone()
    total_entries = row["total"] if row else 0

    return {
        "protected_documents": protected_docs,
        "total_protected_values": total_entries,
        "by_category": by_category,
    }
