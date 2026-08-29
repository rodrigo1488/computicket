"""UI local do agente Uniplus (porta 5100)."""
from __future__ import annotations

import os
import sys

from flask import Flask, redirect, render_template, request, url_for, flash

import db
import agent as agent_mod

# PyInstaller: templates extraídos em sys._MEIPASS
if getattr(sys, "frozen", False):
	_template_folder = os.path.join(sys._MEIPASS, "templates")
else:
	_template_folder = "templates"

app = Flask(__name__, template_folder=_template_folder)
app.secret_key = os.environ.get("UNIPLUS_AGENT_UI_SECRET", "uniplus-agent-dev-secret")


@app.route("/")
def index():
	return redirect(url_for("config_page"))


@app.route("/config", methods=["GET", "POST"])
def config_page():
	if request.method == "POST":
		keys = [
			"ws_url", "device_id", "token",
			"pg_host", "pg_port", "pg_db", "pg_user", "pg_password",
			"agent_enabled",
		]
		values = {k: (request.form.get(k) or "").strip() for k in keys}
		if "agent_enabled" not in request.form:
			values["agent_enabled"] = "false"
		else:
			values["agent_enabled"] = "true"
		db.set_many(values)
		agent_mod.restart_agent_thread()
		flash("Configuração salva. Agente reiniciado.", "success")
		return redirect(url_for("config_page"))

	cfg = db.get_all_config()
	state = agent_mod.get_state()
	return render_template("config.html", cfg=cfg, state=state)


@app.route("/logs")
def logs_page():
	logs = db.recent_logs(150)
	state = agent_mod.get_state()
	return render_template("logs.html", logs=logs, state=state)


@app.route("/status")
def status_api():
	from flask import jsonify
	return jsonify({"state": agent_mod.get_state(), "config": {
		k: ("***" if "password" in k or k == "token" else v)
		for k, v in db.get_all_config().items()
	}})


def run_flask():
	"""Sobe a UI Flask (chamado pelo main ou pela bandeja)."""
	host = os.environ.get("UNIPLUS_AGENT_HOST", "0.0.0.0")
	port = int(os.environ.get("UNIPLUS_AGENT_PORT", "5100"))
	print(f"Uniplus Agent UI em http://{host}:{port}")
	app.run(host=host, port=port, debug=False, use_reloader=False)


def main():
	db.init_db()
	# Modo bandeja: --tray ou executável PyInstaller (sem console)
	use_tray = "--tray" in sys.argv or getattr(sys, "frozen", False)
	if use_tray:
		try:
			from tray import run_tray

			run_tray(run_flask)
			return
		except ImportError as e:
			print("Erro ao iniciar bandeja (instale: pip install pystray Pillow):", e)

	print("=" * 50)
	print("Uniplus Agent - Computicket")
	print("=" * 50)
	print(f"Interface: http://localhost:{os.environ.get('UNIPLUS_AGENT_PORT', '5100')}/")
	print("=" * 50)
	agent_mod.start_agent_thread()
	run_flask()


if __name__ == "__main__":
	main()
