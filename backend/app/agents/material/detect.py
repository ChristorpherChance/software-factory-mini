"""类型识别（T-MAT-01 · 扩展名 + MIME）。"""
import mimetypes
from pathlib import Path

EXT = {
    ".md": "md",
    ".markdown": "md",
    ".txt": "txt",
    ".pdf": "pdf",
    ".docx": "docx",
    ".png": "png",
    ".jpg": "jpg",
    ".jpeg": "jpeg",
}


def detect_type(source: str) -> str:
    if source.startswith(("http://", "https://")):
        return "link"
    ext = Path(source).suffix.lower()
    if ext in EXT:
        return EXT[ext]
    mime, _ = mimetypes.guess_type(source)
    if mime and mime.startswith("image/"):
        return "png"
    if mime == "application/pdf":
        return "pdf"
    return "txt"
