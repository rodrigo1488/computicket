"""Interface local Flask do Computicket Monitor Agent."""
from __future__ import annotations

import os
import sys

from flask import Flask, flash, jsonify, redirect, render_template, request, url_for

import agent
import db

TEMPLATE_DIR = os.path.join(getattr(sys, "_MEIPASS", os.path.dirname(__file__)), "templates")
app = Flask(__name__, template_folder=TEMPLATE_DIR)


@app.route("/")
def index():
    return redirect(url_for("config_page"))


@app.route("/config", methods=["GET", "POST"])
def config_page():
    cfg = db.get_public_config()
    if request.method == "POST":
        try:
            server_url = request.form.get("server_url", "")
            activation_code = request.form.get("activation_code", "")
            if activation_code:
                agent.enroll(server_url, activation_code)
                flash("Ativação concluída.", "success")
            else:
                agent.reconfigure(server_url, request.form.get("enabled") == "on")
                flash("Configuração salva e agente reiniciado.", "success")
        except Exception as exc:
            db.add_log("ERROR", f"Falha na configuração: {exc}")
            flash(f"Não foi possível salvar: {exc}", "error")
        return redirect(url_for("config_page"))
    return render_template("config.html", cfg=cfg, state=agent.get_state(), version=agent.VERSION)


@app.route("/logs")
def logs_page():
    return render_template("logs.html", logs=db.recent_logs(), state=agent.get_state())


@app.route("/status")
def status_api():
    return jsonify({"state": agent.get_state(), "config": db.get_public_config()})


def run_flask() -> None:
    port = int(os.environ.get("COMPUTICKET_MONITOR_PORT", "5110"))
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False, threaded=True)


def main() -> None:
    db.init_db()
    app.secret_key = db.get_config("ui_secret")
    if "--no-tray" in sys.argv:
        agent.start_agent()
        run_flask()
        return
    try:
        from tray import run_tray
        run_tray(run_flask)
    except ImportError:
        agent.start_agent()
        run_flask()


if __name__ == "__main__":
    main()
