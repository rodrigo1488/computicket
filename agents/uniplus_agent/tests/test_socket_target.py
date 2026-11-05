import unittest

from agent import resolve_socket_target


class SocketTargetTest(unittest.TestCase):
	def test_direct_api_uses_socketio_and_can_upgrade(self):
		origin, path, polling_only = resolve_socket_target("http://192.168.0.10:5000")
		self.assertEqual(origin, "http://192.168.0.10:5000")
		self.assertEqual(path, "socket.io")
		self.assertFalse(polling_only)

	def test_public_site_uses_flask_proxy_polling(self):
		origin, path, polling_only = resolve_socket_target("https://computicket.example.com")
		self.assertEqual(origin, "https://computicket.example.com")
		self.assertEqual(path, "flask-sio")
		self.assertTrue(polling_only)

	def test_next_dev_port_uses_flask_proxy(self):
		origin, path, polling_only = resolve_socket_target("http://localhost:3000")
		self.assertEqual(origin, "http://localhost:3000")
		self.assertEqual(path, "flask-sio")
		self.assertTrue(polling_only)

	def test_explicit_path_wins(self):
		origin, path, polling_only = resolve_socket_target("https://computicket.example.com/socket.io")
		self.assertEqual(origin, "https://computicket.example.com")
		self.assertEqual(path, "socket.io")
		self.assertFalse(polling_only)

		origin, path, polling_only = resolve_socket_target("http://127.0.0.1:5000/flask-sio")
		self.assertEqual(origin, "http://127.0.0.1:5000")
		self.assertEqual(path, "flask-sio")
		self.assertTrue(polling_only)

	def test_host_without_scheme_assumes_http(self):
		origin, path, polling_only = resolve_socket_target("192.168.0.10:5000")
		self.assertEqual(origin, "http://192.168.0.10:5000")
		self.assertEqual(path, "socket.io")
		self.assertFalse(polling_only)

	def test_ws_scheme_becomes_http(self):
		origin, path, _polling_only = resolve_socket_target("ws://192.168.0.10:5000/uniplus")
		self.assertEqual(origin, "http://192.168.0.10:5000")
		self.assertEqual(path, "socket.io")

	def test_empty_url_defaults_to_local_api(self):
		origin, path, polling_only = resolve_socket_target("")
		self.assertEqual(origin, "http://127.0.0.1:5000")
		self.assertEqual(path, "socket.io")
		self.assertFalse(polling_only)


if __name__ == "__main__":
	unittest.main()
