"""
Bandeja do sistema (system tray) para o Uniplus Agent.
Opções: Abrir configuração, Ver logs, status Conectado/Desconectado, Sair.
"""
from __future__ import annotations

import os
import sys
import threading
import time
import webbrowser
from datetime import datetime


UI_PORT = int(os.environ.get("UNIPLUS_AGENT_PORT", "5100") or 5100)
UI_BASE = f"http://localhost:{UI_PORT}"


def _base_dir() -> str:
	if getattr(sys, "frozen", False):
		return os.path.dirname(sys.executable)
	return os.path.dirname(os.path.abspath(__file__))


def _resource_dir() -> str:
	"""Pasta de recursos embutidos (PyInstaller) ou do projeto."""
	if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
		return sys._MEIPASS  # type: ignore[attr-defined]
	return os.path.dirname(os.path.abspath(__file__))


def _log_file_path() -> str:
	return os.path.join(_base_dir(), "agent_console.log")


def _ico_path() -> str:
	return os.path.join(_resource_dir(), "assets", "uniplus_agent.ico")


class Tee:
	"""Redireciona stdout/stderr para um arquivo e mantém o stream original (se existir)."""

	def __init__(self, stream, path: str):
		self._stream = stream
		self._path = path
		self._file = open(path, "a", encoding="utf-8", errors="replace")

	def write(self, data):
		try:
			if self._stream:
				self._stream.write(data)
			self._file.write(data)
			self._file.flush()
		except Exception:
			pass

	def flush(self):
		try:
			if self._stream:
				self._stream.flush()
			self._file.flush()
		except Exception:
			pass

	def close(self):
		try:
			self._file.close()
		except Exception:
			pass


def _create_icon_image():
	"""Ícone 64x64 (círculo Computicket-ish) se o .ico não estiver disponível."""
	from PIL import Image, ImageDraw

	w, h = 64, 64
	img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
	draw = ImageDraw.Draw(img)
	draw.ellipse([4, 4, 60, 60], fill=(14, 116, 144), outline=(8, 80, 100))
	draw.rectangle([18, 22, 46, 42], fill=(255, 255, 255))
	draw.polygon([(22, 42), (42, 42), (32, 52)], fill=(255, 255, 255))
	return img


def _load_icon_image():
	from PIL import Image

	path = _ico_path()
	if os.path.isfile(path):
		try:
			return Image.open(path)
		except Exception:
			pass
	return _create_icon_image()


def _status_label(_item=None) -> str:
	"""Texto dinâmico do menu (pystray chama com o MenuItem)."""
	try:
		from agent import get_state

		st = get_state()
		if st.get("connected"):
			return "Status: Conectado"
		err = (st.get("last_error") or "").strip()
		if err:
			short = err if len(err) <= 40 else err[:37] + "..."
			return f"Status: Desconectado ({short})"
		event = (st.get("last_event") or "").strip()
		if event == "disabled":
			return "Status: Desabilitado"
		return "Status: Desconectado"
	except Exception:
		return "Status: —"


def run_tray(run_flask_callable):
	"""
	Redireciona stdout/stderr para arquivo, inicia Flask + agente em thread,
	exibe ícone na bandeja do Windows.
	"""
	log_path = _log_file_path()
	_stdout = sys.stdout
	_stderr = sys.stderr
	sys.stdout = Tee(_stdout, log_path)
	sys.stderr = Tee(_stderr, log_path)

	print(
		f"\n{'=' * 60}\n"
		f"Uniplus Agent - Sessão iniciada em {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
		f"{'=' * 60}\n"
	)

	from agent import start_agent_thread, stop_agent_thread

	flask_thread = threading.Thread(target=run_flask_callable, daemon=True)
	flask_thread.start()
	time.sleep(1.0)
	start_agent_thread()

	try:
		import pystray
	except ImportError:
		print("[ERRO] pystray não instalado. Execute: pip install pystray Pillow")
		sys.stdout = _stdout
		sys.stderr = _stderr
		# Sem bandeja: Flask já está rodando na thread; bloquear no join.
		flask_thread.join()
		return

	def on_abrir_config(icon, item):
		webbrowser.open(f"{UI_BASE}/config")

	def on_ver_logs(icon, item):
		path = _log_file_path()
		if os.path.isfile(path) and sys.platform == "win32":
			os.startfile(path)  # noqa: S606
		else:
			webbrowser.open(f"{UI_BASE}/logs")

	def on_sair(icon, item):
		stop_agent_thread()
		icon.stop()
		if hasattr(sys.stdout, "close"):
			sys.stdout.close()
		if hasattr(sys.stderr, "close"):
			sys.stderr.close()
		os._exit(0)

	icon_image = _load_icon_image()
	menu = pystray.Menu(
		pystray.MenuItem("Abrir configuração", on_abrir_config, default=True),
		pystray.MenuItem("Ver logs", on_ver_logs),
		pystray.Menu.SEPARATOR,
		pystray.MenuItem(_status_label, None, enabled=False),
		pystray.Menu.SEPARATOR,
		pystray.MenuItem("Sair", on_sair),
	)
	icon = pystray.Icon("uniplus_agent", icon_image, "Uniplus Agent", menu)

	def _refresh_title():
		while True:
			try:
				label = _status_label()
				icon.title = f"Uniplus Agent — {label.replace('Status: ', '')}"
				icon.update_menu()
			except Exception:
				pass
			time.sleep(3.0)

	threading.Thread(target=_refresh_title, name="tray-status", daemon=True).start()

	print(f"[INFO] Uniplus Agent na bandeja. Log: {log_path}")
	print(f"[INFO] Interface: {UI_BASE}/")
	icon.run()
