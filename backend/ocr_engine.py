import io
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_HAS_TESSERACT = False
_HAS_PIL = False

try:
    from PIL import Image
    _HAS_PIL = True
except ImportError:
    pass

try:
    import pytesseract
    _HAS_TESSERACT = True
    if os.name == "nt":
        tesseract_paths = [
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        ]
        for path in tesseract_paths:
            if os.path.exists(path):
                pytesseract.pytesseract.tesseract_cmd = path
                break
except ImportError:
    pass


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif", ".webp", ".gif"}


def is_image_file(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in IMAGE_EXTENSIONS


def is_scanned_pdf(content: str) -> bool:
    if not content:
        return True
    pages = content.count("[Страница")
    if pages == 0:
        return len(content.strip()) < 100
    avg_chars = len(content) / max(pages, 1)
    return avg_chars < 100


async def ocr_image_bytes(image_bytes: bytes, filename: str = "", lang: str = "rus+eng") -> str:
    if not _HAS_PIL:
        return f"[OCR недоступен: библиотека Pillow не установлена. pip install Pillow]"

    if not _HAS_TESSERACT:
        return f"[OCR недоступен: pytesseract не установлен. pip install pytesseract]"

    try:
        image = Image.open(io.BytesIO(image_bytes))

        if image.mode != "L":
            image = image.convert("L")

        text = pytesseract.image_to_string(image, lang=lang)
        text = text.strip()

        if not text:
            return f"[OCR не смог распознать текст в изображении {filename}]"

        return text

    except Exception as e:
        logger.error("OCR failed for %s: %s", filename, e)
        return f"[Ошибка OCR: {str(e)}]"


async def ocr_image_file(file_path: str, lang: str = "rus+eng") -> str:
    try:
        with open(file_path, "rb") as f:
            image_bytes = f.read()
        return await ocr_image_bytes(image_bytes, os.path.basename(file_path), lang)
    except Exception as e:
        return f"[Ошибка чтения файла: {str(e)}]"


def get_ocr_status() -> dict:
    status = {
        "available": _HAS_TESSERACT and _HAS_PIL,
        "tesseract_installed": _HAS_TESSERACT,
        "pillow_installed": _HAS_PIL,
        "supported_formats": list(IMAGE_EXTENSIONS) if _HAS_PIL else [],
    }

    if _HAS_TESSERACT:
        try:
            version = pytesseract.get_tesseract_version()
            status["tesseract_version"] = str(version)
            langs = pytesseract.get_languages()
            status["available_languages"] = langs
        except Exception:
            status["tesseract_version"] = "unknown"
            status["available_languages"] = []

    return status
