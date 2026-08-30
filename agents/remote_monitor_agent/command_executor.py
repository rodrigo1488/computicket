"""Execução serial, persistente e auditável de comandos remotos."""
from __future__ import annotations

import json
import ntpath
import os
import queue
import shutil
import sqlite3
import stat
import string
import subprocess
import sys
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

import requests

MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_DIRECTORY_ENTRIES = 2000
HTTP_TIMEOUT = (5, 120)
IDEMPOTENT_RECOVERY_COMMANDS = frozenset(
    {"list_directory", "mkdir", "rename", "move", "copy", "delete", "upload_file", "download_file"}
)
POWER_COMMANDS = frozenset({"reboot", "shutdown"})
SUPPORTED_COMMANDS = IDEMPOTENT_RECOVERY_COMMANDS | POWER_COMMANDS
FILE_ATTRIBUTE_REPARSE_POINT = 0x400


def normalize_windows_path(value: Any, field: str = "path", *, allow_empty: bool = False) -> Path | None:
    """Valida caminho local absoluto de drive, sem namespaces de dispositivo ou UNC."""
    raw = str(value or "")
    if not raw and allow_empty:
        return None
    if "\x00" in raw:
        raise ValueError(f"{field} contém caractere NUL")
    normalized = raw.replace("/", "\\")
    lowered = normalized.lower()
    if lowered.startswith(("\\\\.\\", "\\\\?\\")) or normalized.startswith("\\\\"):
        raise ValueError(f"{field} não permite caminho UNC ou de dispositivo")
    drive, tail = ntpath.splitdrive(normalized)
    if len(drive) != 2 or drive[1] != ":" or drive[0] not in string.ascii_letters or not tail.startswith("\\"):
        raise ValueError(f"{field} deve ser um caminho absoluto do Windows")
    clean = ntpath.normpath(normalized)
    return Path(clean)


def _is_volume_root(path: Path) -> bool:
    _drive, tail = ntpath.splitdrive(str(path))
    return tail in {"\\", "/"}


def _require_not_root(path: Path, operation: str) -> None:
    if _is_volume_root(path):
        raise ValueError(f"{operation} não é permitido na raiz de um volume")


def _is_reparse_point(path: Path) -> bool:
    info = os.lstat(path)
    attributes = int(getattr(info, "st_file_attributes", 0))
    return stat.S_ISLNK(info.st_mode) or bool(attributes & FILE_ATTRIBUTE_REPARSE_POINT)


def _validate_tree_without_reparse(path: Path) -> None:
    if _is_reparse_point(path):
        raise ValueError(f"Reparse point/symlink não permitido: {path}")
    if not path.is_dir():
        return
    with os.scandir(path) as entries:
        for entry in entries:
            child = Path(entry.path)
            if entry.is_symlink() or _is_reparse_point(child):
                raise ValueError(f"Reparse point/symlink não permitido: {child}")
            if entry.is_dir(follow_symlinks=False):
                _validate_tree_without_reparse(child)


def _iso_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")


def _list_drives() -> dict[str, Any]:
    drives = []
    for letter in string.ascii_uppercase:
        path = f"{letter}:\\"
        if os.path.exists(path):
            drives.append(
                {
                    "name": f"{letter}:",
                    "path": path,
                    "is_directory": True,
                    "is_file": False,
                    "size": None,
                    "modified_at": None,
                    "hidden": False,
                }
            )
    return {"path": "", "entries": drives, "truncated": False}


def list_directory(payload: dict[str, Any]) -> dict[str, Any]:
    path = normalize_windows_path(payload.get("path", ""), allow_empty=True)
    if path is None:
        return _list_drives()
    if not path.is_dir():
        raise ValueError("Diretório não encontrado")
    rows: list[dict[str, Any]] = []
    truncated = False
    with os.scandir(path) as entries:
        for entry in entries:
            if len(rows) >= MAX_DIRECTORY_ENTRIES:
                truncated = True
                break
            try:
                info = entry.stat(follow_symlinks=False)
                is_directory = entry.is_dir(follow_symlinks=False)
                is_file = entry.is_file(follow_symlinks=False)
                attributes = int(getattr(info, "st_file_attributes", 0))
                hidden = entry.name.startswith(".") or bool(attributes & getattr(stat, "FILE_ATTRIBUTE_HIDDEN", 0x2))
                rows.append(
                    {
                        "name": entry.name,
                        "path": ntpath.normpath(entry.path),
                        "is_directory": is_directory,
                        "is_file": is_file,
                        "size": info.st_size if is_file else None,
                        "modified_at": _iso_timestamp(info.st_mtime),
                        "hidden": hidden,
                    }
                )
            except OSError:
                continue
    rows.sort(key=lambda row: (not row["is_directory"], str(row["name"]).casefold()))
    return {"path": str(path), "entries": rows, "truncated": truncated}


def _mkdir(payload: dict[str, Any]) -> dict[str, Any]:
    path = normalize_windows_path(payload.get("path"))
    assert path is not None
    parents = payload.get("parents", False)
    if not isinstance(parents, bool):
        raise ValueError("parents deve ser booleano")
    path.mkdir(parents=parents, exist_ok=False)
    return {"path": str(path), "created": True}


def _source_and_destination(payload: dict[str, Any]) -> tuple[Path, Path]:
    source = normalize_windows_path(payload.get("source_path"), "source_path")
    destination = normalize_windows_path(payload.get("destination_path"), "destination_path")
    assert source is not None and destination is not None
    _require_not_root(source, "Operação")
    if not source.exists():
        raise ValueError("Origem não encontrada")
    if destination.exists():
        raise FileExistsError("Destino já existe; sobrescrita não é permitida")
    if not destination.parent.is_dir():
        raise ValueError("Diretório pai do destino não existe")
    return source, destination


def _is_descendant(candidate: Path, parent: Path) -> bool:
    try:
        common = ntpath.commonpath((ntpath.normcase(str(candidate)), ntpath.normcase(str(parent))))
    except ValueError:
        return False
    return common == ntpath.normcase(str(parent)) and ntpath.normcase(str(candidate)) != common


def _rename_or_move(payload: dict[str, Any]) -> dict[str, Any]:
    source, destination = _source_and_destination(payload)
    if source.is_dir() and _is_descendant(destination, source):
        raise ValueError("Destino não pode estar dentro do diretório de origem")
    source.rename(destination)
    return {"source_path": str(source), "destination_path": str(destination)}


def _copy(payload: dict[str, Any]) -> dict[str, Any]:
    source, destination = _source_and_destination(payload)
    if source.is_dir():
        if _is_descendant(destination, source):
            raise ValueError("Destino não pode estar dentro do diretório de origem")
        _validate_tree_without_reparse(source)
        shutil.copytree(source, destination, symlinks=True)
    elif source.is_file() and not _is_reparse_point(source):
        shutil.copy2(source, destination, follow_symlinks=False)
    else:
        raise ValueError("Origem deve ser arquivo regular ou diretório")
    return {"source_path": str(source), "destination_path": str(destination)}


def _delete(payload: dict[str, Any]) -> dict[str, Any]:
    path = normalize_windows_path(payload.get("path"))
    assert path is not None
    _require_not_root(path, "Exclusão")
    if not path.exists() and not path.is_symlink():
        raise ValueError("Caminho não encontrado")
    if _is_reparse_point(path):
        raise ValueError("Exclusão de reparse point/symlink não permitida")
    if path.is_dir():
        _validate_tree_without_reparse(path)
        shutil.rmtree(path)
    elif path.is_file():
        path.unlink()
    else:
        raise ValueError("Caminho não é arquivo regular nem diretório")
    return {"path": str(path), "deleted": True}


def _auth_headers(device_id: str, token: str) -> dict[str, str]:
    return {"X-Device-Id": device_id, "Authorization": f"Bearer {token}"}


def _upload_file(
    payload: dict[str, Any], base_url: str, device_id: str, token: str, session: requests.Session
) -> dict[str, Any]:
    destination = normalize_windows_path(payload.get("remote_path"), "remote_path")
    assert destination is not None
    _require_not_root(destination, "Upload")
    if destination.exists():
        raise FileExistsError("Destino já existe; sobrescrita não é permitida")
    if not destination.parent.is_dir():
        raise ValueError("Diretório pai do destino não existe")
    transfer_uuid = str(uuid.UUID(str(payload.get("transfer_uuid") or "")))
    part = destination.with_name(f".{destination.name}.{transfer_uuid}.part")
    total = 0
    try:
        with session.get(
            f"{base_url}/api/remote-monitor/agent/transfers/{transfer_uuid}/content",
            headers=_auth_headers(device_id, token),
            stream=True,
            timeout=HTTP_TIMEOUT,
            verify=True,
        ) as response:
            response.raise_for_status()
            length = response.headers.get("Content-Length")
            if length and int(length) > MAX_FILE_BYTES:
                raise ValueError("Arquivo excede o limite de 50 MiB")
            with part.open("xb") as output:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > MAX_FILE_BYTES:
                        raise ValueError("Arquivo excede o limite de 50 MiB")
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
        if destination.exists():
            raise FileExistsError("Destino passou a existir; sobrescrita não é permitida")
        os.rename(part, destination)
    finally:
        try:
            part.unlink(missing_ok=True)
        except OSError:
            pass
    return {"path": str(destination), "size": total, "transfer_uuid": transfer_uuid}


def _download_file(
    payload: dict[str, Any], base_url: str, device_id: str, token: str, session: requests.Session
) -> dict[str, Any]:
    source = normalize_windows_path(payload.get("remote_path"), "remote_path")
    assert source is not None
    _require_not_root(source, "Download")
    if not source.is_file() or _is_reparse_point(source):
        raise ValueError("Origem deve ser um arquivo regular")
    size = source.stat().st_size
    if size > MAX_FILE_BYTES:
        raise ValueError("Arquivo excede o limite de 50 MiB")
    transfer_uuid = str(uuid.UUID(str(payload.get("transfer_uuid") or "")))
    with source.open("rb") as stream:
        response = session.put(
            f"{base_url}/api/remote-monitor/agent/transfers/{transfer_uuid}/content",
            headers={**_auth_headers(device_id, token), "Content-Type": "application/octet-stream"},
            data=stream,
            timeout=HTTP_TIMEOUT,
            verify=True,
        )
    response.raise_for_status()
    return {"transfer_uuid": transfer_uuid, "size": size}


def _invoke_windows_power(action: str) -> None:
    """Único ponto que dispara energia; mantido isolado para mocking obrigatório em testes."""
    if sys.platform != "win32":
        raise RuntimeError("Reinício/desligamento remoto só é suportado no Windows")
    flag = "/r" if action == "reboot" else "/s"
    subprocess.Popen(
        ["shutdown.exe", flag, "/t", "5", "/f"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


class CommandExecutor:
    """Worker único com deduplicação persistente por ID de comando."""

    def __init__(
        self,
        db_path: str,
        credentials: Callable[[], tuple[str, str, str]],
        report_started: Callable[[str], bool],
        report_result: Callable[[str, str, dict[str, Any], str | None], bool],
        logger: Callable[[str, object], None],
        session: requests.Session | None = None,
    ) -> None:
        self.db_path = db_path
        self.credentials = credentials
        self.report_started = report_started
        self.report_result = report_result
        self.logger = logger
        self.session = session or requests.Session()
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._db_lock = threading.RLock()
        self._init_db()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.db_path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=15000")
        try:
            yield connection
        finally:
            connection.close()

    def _init_db(self) -> None:
        with self._db_lock, self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS processed_commands (
                    command_id TEXT PRIMARY KEY,
                    command_type TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    state TEXT NOT NULL,
                    result TEXT,
                    error TEXT,
                    updated_at REAL NOT NULL
                )
                """
            )
            connection.execute(
                "UPDATE processed_commands SET state='recovering', updated_at=? "
                "WHERE state='running' AND command_type NOT IN ('reboot','shutdown')",
                (time.time(),),
            )
            connection.commit()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="remote-command-worker", daemon=True)
        self._thread.start()
        with self._db_lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT command_id FROM processed_commands "
                "WHERE state IN ('queued','recovering','power_pending') ORDER BY updated_at"
            ).fetchall()
        for row in rows:
            self._queue.put(str(row["command_id"]))

    def stop(self) -> None:
        self._stop.set()
        self._queue.put(None)
        if self._thread:
            self._thread.join(timeout=5)

    def enqueue(self, command: dict[str, Any], *, confirmed_pending: bool = True) -> bool:
        command_id = str(command.get("id") or command.get("command_id") or "").strip()
        command_type = str(command.get("command_type") or "").strip().lower()
        payload = command.get("payload") or {}
        if not command_id or command_type not in SUPPORTED_COMMANDS or not isinstance(payload, dict):
            raise ValueError("Comando remoto inválido ou não suportado")
        should_queue = False
        now = time.time()
        with self._db_lock, self._connect() as connection:
            row = connection.execute(
                "SELECT state,command_type,payload FROM processed_commands WHERE command_id=?", (command_id,)
            ).fetchone()
            if row is None:
                connection.execute(
                    "INSERT INTO processed_commands VALUES (?,?,?,?,?,?,?)",
                    (
                        command_id,
                        command_type,
                        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                        "queued",
                        None,
                        None,
                        now,
                    ),
                )
                should_queue = True
            elif row["state"] in {"done", "error", "power_pending"}:
                should_queue = True  # o worker somente reenvia o resultado persistido
            elif row["state"] == "running" and confirmed_pending:
                connection.execute(
                    "UPDATE processed_commands SET state='queued',updated_at=? WHERE command_id=?",
                    (now, command_id),
                )
                should_queue = True
            connection.commit()
        if should_queue:
            self._queue.put(command_id)
        return should_queue

    def stats(self) -> dict[str, Any]:
        with self._db_lock, self._connect() as connection:
            pending = int(
                connection.execute(
                    "SELECT COUNT(*) FROM processed_commands "
                    "WHERE state IN ('queued','recovering','running','power_pending')"
                ).fetchone()[0]
            )
            row = connection.execute(
                "SELECT command_id,command_type,state,updated_at FROM processed_commands ORDER BY updated_at DESC LIMIT 1"
            ).fetchone()
        return {"pending": pending, "last": dict(row) if row else None}

    def _load(self, command_id: str) -> sqlite3.Row | None:
        with self._db_lock, self._connect() as connection:
            return connection.execute(
                "SELECT * FROM processed_commands WHERE command_id=?", (command_id,)
            ).fetchone()

    def _set_terminal(self, command_id: str, state: str, result: dict[str, Any], error: str | None) -> None:
        with self._db_lock, self._connect() as connection:
            connection.execute(
                "UPDATE processed_commands SET state=?,result=?,error=?,updated_at=? WHERE command_id=?",
                (
                    state,
                    json.dumps(result, ensure_ascii=False, separators=(",", ":")),
                    error,
                    time.time(),
                    command_id,
                ),
            )
            connection.commit()

    def _run(self) -> None:
        while not self._stop.is_set():
            command_id = self._queue.get()
            if command_id is None:
                return
            try:
                self._process(command_id)
            except Exception as exc:
                self.logger("ERROR", f"Falha interna no worker do comando {command_id}: {exc}")

    def _retry_later(self, command_id: str) -> None:
        def retry() -> None:
            if not self._stop.is_set():
                self._queue.put(command_id)

        timer = threading.Timer(15, retry)
        timer.daemon = True
        timer.start()

    def _process(self, command_id: str) -> None:
        row = self._load(command_id)
        if row is None:
            return
        if row["state"] in {"done", "error"}:
            result = json.loads(row["result"] or "{}")
            if not self.report_result(command_id, str(row["state"]), result, row["error"]):
                self._retry_later(command_id)
            self.logger("INFO", f"Resultado deduplicado reenviado para comando {command_id}")
            return
        if row["state"] == "power_pending":
            result = json.loads(row["result"] or "{}")
            if not self.report_result(command_id, "done", result, None):
                self._retry_later(command_id)
                return
            self._set_terminal(command_id, "done", result, None)
            _invoke_windows_power(str(row["command_type"]))
            return
        recovering = row["state"] == "recovering"
        with self._db_lock, self._connect() as connection:
            connection.execute(
                "UPDATE processed_commands SET state='running',updated_at=? WHERE command_id=?",
                (time.time(), command_id),
            )
            connection.commit()
        self.report_started(command_id)
        command_type = str(row["command_type"])
        payload = json.loads(row["payload"])
        power_action: str | None = None
        try:
            if command_type in POWER_COMMANDS:
                if sys.platform != "win32":
                    raise RuntimeError("Reinício/desligamento remoto só é suportado no Windows")
                result = {"accepted": True, "delay_seconds": 5}
                power_action = command_type
            else:
                result = self._execute_recovery(command_type, payload) if recovering else self._execute(command_type, payload)
            terminal_state = "power_pending" if power_action else "done"
            self._set_terminal(command_id, terminal_state, result, None)
            reported = self.report_result(command_id, "done", result, None)
            self.logger("INFO", f"Comando {command_id} ({command_type}) concluído")
            if power_action:
                if not reported:
                    self._retry_later(command_id)
                    return
                self._set_terminal(command_id, "done", result, None)
                _invoke_windows_power(power_action)
            elif not reported:
                self._retry_later(command_id)
        except Exception as exc:
            error = str(exc)[:4000]
            if power_action and self._load(command_id)["state"] == "done":
                self.logger("ERROR", f"Comando {command_id}: {error}")
                return
            self._set_terminal(command_id, "error", {}, error)
            if not self.report_result(command_id, "error", {}, error):
                self._retry_later(command_id)
            self.logger("ERROR", f"Comando {command_id} ({command_type}) falhou: {error}")

    def _execute_recovery(self, command_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Reconhece o estado final antes de repetir uma operação interrompida."""
        if command_type == "mkdir":
            path = normalize_windows_path(payload.get("path"))
            if path and path.is_dir():
                return {"path": str(path), "created": True, "recovered": True}
        elif command_type in {"rename", "move", "copy"}:
            source = normalize_windows_path(payload.get("source_path"), "source_path")
            destination = normalize_windows_path(payload.get("destination_path"), "destination_path")
            if source and destination and not source.exists() and destination.exists():
                return {
                    "source_path": str(source),
                    "destination_path": str(destination),
                    "recovered": True,
                }
            if command_type == "copy" and destination and destination.exists():
                return {
                    "source_path": str(source),
                    "destination_path": str(destination),
                    "recovered": True,
                }
        elif command_type == "delete":
            path = normalize_windows_path(payload.get("path"))
            if path and not path.exists() and not path.is_symlink():
                return {"path": str(path), "deleted": True, "recovered": True}
        elif command_type == "upload_file":
            destination = normalize_windows_path(payload.get("remote_path"), "remote_path")
            if destination and destination.is_file() and destination.stat().st_size <= MAX_FILE_BYTES:
                return {
                    "path": str(destination),
                    "size": destination.stat().st_size,
                    "transfer_uuid": str(payload.get("transfer_uuid") or ""),
                    "recovered": True,
                }
        return self._execute(command_type, payload)

    def _execute(self, command_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        if command_type == "list_directory":
            return list_directory(payload)
        if command_type == "mkdir":
            return _mkdir(payload)
        if command_type in {"rename", "move"}:
            return _rename_or_move(payload)
        if command_type == "copy":
            return _copy(payload)
        if command_type == "delete":
            return _delete(payload)
        base_url, device_id, token = self.credentials()
        if command_type == "upload_file":
            return _upload_file(payload, base_url, device_id, token, self.session)
        if command_type == "download_file":
            return _download_file(payload, base_url, device_id, token, self.session)
        raise ValueError(f"Tipo de comando não suportado: {command_type}")
