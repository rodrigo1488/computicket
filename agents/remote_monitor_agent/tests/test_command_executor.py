from __future__ import annotations

import os
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from unittest import mock

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import command_executor as commands


@unittest.skipUnless(os.name == "nt", "Operações de caminho exigem Windows")
class FileCommandTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_list_directory_metadata_sort_and_empty_path(self):
        (self.root / "z-dir").mkdir()
        (self.root / "a.txt").write_bytes(b"abc")
        result = commands.list_directory({"path": str(self.root)})
        self.assertEqual([row["name"] for row in result["entries"]], ["z-dir", "a.txt"])
        self.assertTrue(result["entries"][0]["is_directory"])
        self.assertEqual(result["entries"][1]["size"], 3)
        with mock.patch.object(commands, "_list_drives", return_value={"entries": [], "truncated": False}):
            self.assertEqual(commands.list_directory({"path": ""})["entries"], [])

    def test_mkdir_without_and_with_parents(self):
        leaf = self.root / "leaf"
        result = commands._mkdir({"path": str(leaf)})
        self.assertTrue(leaf.is_dir())
        self.assertTrue(result["created"])
        nested = self.root / "one" / "two"
        commands._mkdir({"path": str(nested), "parents": True})
        self.assertTrue(nested.is_dir())

    def test_copy_file_and_directory_without_overwrite(self):
        source = self.root / "source.txt"
        source.write_text("conteudo", encoding="utf-8")
        destination = self.root / "copied.txt"
        commands._copy({"source_path": str(source), "destination_path": str(destination)})
        self.assertEqual(destination.read_text(encoding="utf-8"), "conteudo")

        folder = self.root / "folder"
        folder.mkdir()
        (folder / "nested.txt").write_text("x", encoding="utf-8")
        folder_copy = self.root / "folder-copy"
        commands._copy({"source_path": str(folder), "destination_path": str(folder_copy)})
        self.assertEqual((folder_copy / "nested.txt").read_text(encoding="utf-8"), "x")
        with self.assertRaises(FileExistsError):
            commands._copy({"source_path": str(source), "destination_path": str(destination)})

    def test_rename_move_and_recursive_delete(self):
        original = self.root / "original.txt"
        original.write_text("x", encoding="utf-8")
        renamed = self.root / "renamed.txt"
        commands._rename_or_move({"source_path": str(original), "destination_path": str(renamed)})
        self.assertTrue(renamed.exists())

        target_dir = self.root / "target"
        target_dir.mkdir()
        moved = target_dir / "moved.txt"
        commands._rename_or_move({"source_path": str(renamed), "destination_path": str(moved)})
        self.assertTrue(moved.exists())

        tree = self.root / "tree"
        (tree / "child").mkdir(parents=True)
        (tree / "child" / "file.txt").write_text("x", encoding="utf-8")
        commands._delete({"path": str(tree)})
        self.assertFalse(tree.exists())
        commands._delete({"path": str(moved)})
        self.assertFalse(moved.exists())

    def test_rejects_unc_device_relative_nul_and_volume_root(self):
        invalid = [r"\\server\share\x", r"\\.\C:\x", r"\\?\C:\x", r"C:relative", "C:\\x\x00y"]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                commands.normalize_windows_path(value)
        with self.assertRaises(ValueError):
            commands._delete({"path": f"{self.root.drive}\\"})

    def test_delete_rejects_reparse_point(self):
        link = self.root / "link"
        try:
            link.symlink_to(self.root, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("Criação de symlink não permitida neste ambiente")
        with self.assertRaises(ValueError):
            commands._delete({"path": str(link)})


class _DownloadResponse:
    headers = {"Content-Length": "6"}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def raise_for_status(self):
        return None

    def iter_content(self, chunk_size):
        self.chunk_size = chunk_size
        yield b"abc"
        yield b"def"


class _PutResponse:
    def raise_for_status(self):
        return None


class _FakeSession:
    def __init__(self):
        self.download_response = _DownloadResponse()
        self.put_bytes = b""
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(("get", url, kwargs))
        return self.download_response

    def put(self, url, **kwargs):
        stream = kwargs["data"]
        while True:
            chunk = stream.read(2)
            if not chunk:
                break
            self.put_bytes += chunk
        self.calls.append(("put", url, {key: value for key, value in kwargs.items() if key != "data"}))
        return _PutResponse()


class TransferAndWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.session = _FakeSession()
        self.executor = commands.CommandExecutor(
            str(self.root / "commands.db"),
            lambda: ("https://example.invalid", "device-id", "secret-token"),
            lambda _command_id: True,
            lambda *_args: True,
            lambda *_args: None,
            session=self.session,
        )

    def tearDown(self):
        self.executor.stop()
        self.temp.cleanup()

    @unittest.skipUnless(os.name == "nt", "Operações de caminho exigem Windows")
    def test_upload_streams_to_part_then_renames(self):
        transfer_uuid = str(uuid.uuid4())
        destination = self.root / "received.bin"
        result = self.executor._execute(
            "upload_file", {"remote_path": str(destination), "transfer_uuid": transfer_uuid}
        )
        self.assertEqual(destination.read_bytes(), b"abcdef")
        self.assertEqual(result["size"], 6)
        self.assertFalse(any(self.root.glob("*.part")))
        method, _url, kwargs = self.session.calls[0]
        self.assertEqual(method, "get")
        self.assertTrue(kwargs["stream"])
        self.assertTrue(kwargs["verify"])
        self.assertEqual(kwargs["headers"]["X-Device-Id"], "device-id")

    @unittest.skipUnless(os.name == "nt", "Operações de caminho exigem Windows")
    def test_download_puts_open_stream_and_returns_uuid(self):
        transfer_uuid = str(uuid.uuid4())
        source = self.root / "send.bin"
        source.write_bytes(b"streamed")
        result = self.executor._execute(
            "download_file", {"remote_path": str(source), "transfer_uuid": transfer_uuid}
        )
        self.assertEqual(self.session.put_bytes, b"streamed")
        self.assertEqual(result["transfer_uuid"], transfer_uuid)
        method, _url, kwargs = self.session.calls[-1]
        self.assertEqual(method, "put")
        self.assertTrue(kwargs["verify"])

    @unittest.skipUnless(os.name == "nt", "Operações de caminho exigem Windows")
    def test_transfer_limit_is_enforced(self):
        source = self.root / "large.bin"
        with source.open("wb") as stream:
            stream.truncate(commands.MAX_FILE_BYTES + 1)
        with self.assertRaises(ValueError):
            self.executor._execute(
                "download_file",
                {"remote_path": str(source), "transfer_uuid": str(uuid.uuid4())},
            )

    def test_worker_deduplicates_done_command(self):
        completed = threading.Event()
        executions = []

        def report_result(*_args):
            completed.set()
            return True

        self.executor.report_result = report_result
        self.executor._execute = mock.Mock(side_effect=lambda *_args: executions.append(1) or {"ok": True})
        command = {"id": 10, "command_type": "list_directory", "payload": {"path": ""}}
        self.executor.start()
        self.executor.enqueue(command)
        self.assertTrue(completed.wait(2))
        completed.clear()
        self.executor.enqueue(command)
        self.assertTrue(completed.wait(2))
        self.assertEqual(len(executions), 1)

    def test_power_reports_success_before_mocked_invocation(self):
        events = []
        completed = threading.Event()
        self.executor.report_result = lambda *_args: events.append("reported") or True
        self.executor.start()
        with mock.patch.object(commands.sys, "platform", "win32"), mock.patch.object(
            commands, "_invoke_windows_power", side_effect=lambda _action: (events.append("power"), completed.set())
        ):
            self.executor.enqueue({"id": 11, "command_type": "reboot", "payload": {}})
            self.assertTrue(completed.wait(2))
        self.assertEqual(events, ["reported", "power"])

    def test_power_is_never_invoked_off_windows(self):
        completed = threading.Event()

        def report_result(_id, status, _result, _error):
            if status == "error":
                completed.set()
            return True

        self.executor.report_result = report_result
        self.executor.start()
        with mock.patch.object(commands.sys, "platform", "linux"), mock.patch.object(
            commands, "_invoke_windows_power"
        ) as invoke:
            self.executor.enqueue({"id": 12, "command_type": "shutdown", "payload": {}})
            self.assertTrue(completed.wait(2))
            invoke.assert_not_called()


if __name__ == "__main__":
    unittest.main()
