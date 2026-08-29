import sys

# Evita que o Python quebre com UnicodeEncodeError ao imprimir emojis/acentos em consoles Windows
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

from app import create_app, socketio

app = create_app()

if __name__ == "__main__":
	socketio.run(app, host="0.0.0.0", port=5000, debug=True, allow_unsafe_werkzeug=True)

