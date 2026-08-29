from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import agent
import collector
import db
import security


class NormalizeServerUrlTests(unittest.TestCase):
    def test_accepts_http_localhost_and_lan(self):
        self.assertEqual(agent.normalize_server_url("http://127.0.0.1:5000"), "http://127.0.0.1:5000")
        self.assertEqual(agent.normalize_server_url("http://localhost:5000/"), "http://localhost:5000")
        self.assertEqual(
            agent.normalize_server_url("http://192.168.1.10:5000/api"),
            "http://192.168.1.10:5000/api",
        )
        self.assertEqual(agent.server_origin("http://192.168.1.10:5000/api"), "http://192.168.1.10:5000")
        self.assertEqual(agent.server_origin("127.0.0.1:5000"), "http://127.0.0.1:5000")

    def test_accepts_https(self):
        self.assertEqual(
            agent.normalize_server_url("https://computicket.exemplo.com"),
            "https://computicket.exemplo.com",
        )

    def test_infers_http_when_scheme_missing(self):
        self.assertEqual(agent.normalize_server_url("127.0.0.1:5000"), "http://127.0.0.1:5000")
        self.assertEqual(agent.normalize_server_url("localhost:5000"), "http://localhost:5000")
        self.assertEqual(agent.normalize_server_url("192.168.0.5:5000"), "http://192.168.0.5:5000")

    def test_converts_ws_schemes(self):
        self.assertEqual(agent.normalize_server_url("ws://127.0.0.1:5000"), "http://127.0.0.1:5000")
        self.assertEqual(agent.normalize_server_url("wss://exemplo.com"), "https://exemplo.com")

    def test_rejects_credentials_and_bad_urls(self):
        with self.assertRaises(ValueError):
            agent.normalize_server_url("http://user:pass@127.0.0.1:5000")
        with self.assertRaises(ValueError):
            agent.normalize_server_url("http://user@127.0.0.1:5000")
        with self.assertRaises(ValueError):
            agent.normalize_server_url("ftp://127.0.0.1:5000")
        with self.assertRaises(ValueError):
            agent.normalize_server_url("")
        with self.assertRaises(ValueError):
            agent.normalize_server_url("http://")


class NormalizationAndCollectionTests(unittest.TestCase):
    def test_normalize_percent(self):
        self.assertEqual(collector.normalize_percent("12.345"), 12.35)
        self.assertEqual(collector.normalize_percent(150), 100.0)
        self.assertIsNone(collector.normalize_percent(-1))
        self.assertIsNone(collector.normalize_percent("x"))

    def test_light_collection_shape(self):
        snapshot = collector.collect_light()
        self.assertIn("cpu_percent", snapshot)
        self.assertIn("memory", snapshot)
        self.assertIn("volumes", snapshot)
        self.assertIn("network", snapshot)
        self.assertGreaterEqual(snapshot["uptime_seconds"], 0)
        self.assertTrue(snapshot["temperatures"] is None or isinstance(snapshot["temperatures"], list))


class BufferTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_file = db.DB_FILE
        db.DB_FILE = os.path.join(self.tmp.name, "test.db")
        db.init_db()

    def tearDown(self):
        db.DB_FILE = self.old_file
        self.tmp.cleanup()

    def test_enqueue_ack_and_limit(self):
        with mock.patch.object(db, "MAX_BUFFER_ROWS", 2):
            ids = [db.enqueue({"n": n}) for n in range(3)]
        self.assertEqual(db.buffer_count(), 2)
        self.assertEqual([item["id"] for item in db.pending()], ids[1:])
        db.acknowledge(ids[-1])
        self.assertEqual(db.buffer_count(), 1)


class SecurityFallbackTests(unittest.TestCase):
    def test_non_windows_fallback_requires_explicit_opt_in(self):
        with mock.patch.object(security.sys, "platform", "linux"), mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(security.SecretProtectionError):
                security.protect_secret("token")

    def test_non_windows_fallback_round_trip(self):
        env = {"COMPUTICKET_ALLOW_INSECURE_TOKEN_STORAGE": "1"}
        with mock.patch.object(security.sys, "platform", "linux"), mock.patch.dict(os.environ, env, clear=True):
            with self.assertWarns(RuntimeWarning):
                encrypted = security.protect_secret("segredo")
            self.assertNotIn("segredo", encrypted)
            self.assertEqual(security.unprotect_secret(encrypted), "segredo")


if __name__ == "__main__":
    unittest.main()
