import sys
from pathlib import Path

# Evita que o Python quebre com UnicodeEncodeError ao imprimir emojis/acentos em consoles Windows
if hasattr(sys.stdout, "reconfigure"):
	try:
		sys.stdout.reconfigure(encoding="utf-8", errors="replace")
		sys.stderr.reconfigure(encoding="utf-8", errors="replace")
	except Exception:
		pass

# O pacote real fica em api/app/app/. Sem este path, `from app` carrega
# api/app/__init__.py (sem blueprints) e quebra com ModuleNotFoundError.
_pkg_root = Path(__file__).resolve().parent / "app"
if str(_pkg_root) not in sys.path:
	sys.path.insert(0, str(_pkg_root))

from app import create_app, socketio

app = create_app()

if __name__ == "__main__":
	import os

	port = int(os.environ.get("PORT", "5000"))
	debug = (os.environ.get("FLASK_DEBUG") or os.environ.get("DEBUG") or "").strip().lower() in {
		"1",
		"true",
		"yes",
		"on",
	}
	socketio.run(app, host="0.0.0.0", port=port, debug=debug, allow_unsafe_werkzeug=True)
