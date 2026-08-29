"""Proteção de segredos locais com DPAPI do Windows."""
from __future__ import annotations

import base64
import ctypes
import os
import sys
import warnings
from ctypes import wintypes

_PREFIX_DPAPI = "dpapi:"
_PREFIX_DEV = "dev-insecure:"
_FALLBACK_ENV = "COMPUTICKET_ALLOW_INSECURE_TOKEN_STORAGE"


class SecretProtectionError(RuntimeError):
    pass


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def _blob(data: bytes) -> tuple[_DATA_BLOB, object]:
    buf = ctypes.create_string_buffer(data)
    return _DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte))), buf


def _dpapi_protect(data: bytes) -> bytes:
    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    source, keepalive = _blob(data)
    output = _DATA_BLOB()
    if not crypt32.CryptProtectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        kernel32.LocalFree(ctypes.cast(output.pbData, ctypes.c_void_p))


def _dpapi_unprotect(data: bytes) -> bytes:
    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    source, keepalive = _blob(data)
    output = _DATA_BLOB()
    if not crypt32.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        kernel32.LocalFree(ctypes.cast(output.pbData, ctypes.c_void_p))


def _fallback_allowed() -> bool:
    return sys.platform != "win32" and os.environ.get(_FALLBACK_ENV) == "1"


def protect_secret(value: str) -> str:
    if not value:
        return ""
    raw = value.encode("utf-8")
    if sys.platform == "win32":
        return _PREFIX_DPAPI + base64.b64encode(_dpapi_protect(raw)).decode("ascii")
    if not _fallback_allowed():
        raise SecretProtectionError(
            f"DPAPI indisponível; defina {_FALLBACK_ENV}=1 somente em desenvolvimento não-Windows"
        )
    warnings.warn("Armazenamento inseguro habilitado para desenvolvimento", RuntimeWarning, stacklevel=2)
    return _PREFIX_DEV + base64.b64encode(raw).decode("ascii")


def unprotect_secret(value: str) -> str:
    if not value:
        return ""
    try:
        if value.startswith(_PREFIX_DPAPI) and sys.platform == "win32":
            return _dpapi_unprotect(base64.b64decode(value[len(_PREFIX_DPAPI) :])).decode("utf-8")
        if value.startswith(_PREFIX_DEV) and _fallback_allowed():
            return base64.b64decode(value[len(_PREFIX_DEV) :]).decode("utf-8")
    except Exception as exc:
        raise SecretProtectionError("Não foi possível descriptografar o segredo") from exc
    raise SecretProtectionError("Formato de segredo inválido ou indisponível nesta plataforma")
