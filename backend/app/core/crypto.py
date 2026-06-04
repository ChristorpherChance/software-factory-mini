"""AES-256-GCM 加密与遮罩（T-SET-03 / PRD-NFR-008）。

主密钥来自 ``settings.secrets_master_key``（支持 ``base64:`` 前缀的 32 字节 base64）。
密文以 base64 字符串存储（nonce(12) || ciphertext+tag），适配 Endpoint.api_key_cipher(TEXT)。
"""
import os
import base64

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ..config import settings


def _key() -> bytes:
    raw = settings.secrets_master_key
    raw = raw[len("base64:"):] if raw.startswith("base64:") else raw
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise RuntimeError("secrets_master_key 必须是 base64 编码的 32 字节")
    return key


def encrypt(plaintext: str | None) -> str | None:
    if plaintext is None:
        return None
    nonce = os.urandom(12)
    ct = AESGCM(_key()).encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def decrypt(cipher: str | None) -> str | None:
    if not cipher:
        return None
    blob = base64.b64decode(cipher)
    nonce, ct = blob[:12], blob[12:]
    return AESGCM(_key()).decrypt(nonce, ct, None).decode()


def mask(value) -> dict:
    """前端展示用：只露尾 4 位，其余遮蔽。"""
    s = value.get("display", "") if isinstance(value, dict) else str(value)
    return {"masked": True, "hint": ("••••" + s[-4:]) if len(s) >= 4 else "••••"}
