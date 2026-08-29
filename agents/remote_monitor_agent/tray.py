"""Ícone de bandeja do agente Windows."""
from __future__ import annotations

import os
import threading
import time
import webbrowser

import pystray
from PIL import Image, ImageDraw

import agent

PORT = int(os.environ.get("COMPUTICKET_MONITOR_PORT", "5110"))
UI_URL = f"http://127.0.0.1:{PORT}"


def _icon_image() -> Image.Image:
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((4, 4, 60, 60), fill=(15, 118, 150), outline=(8, 70, 90), width=3)
    draw.line((17, 34, 26, 43, 47, 20), fill="white", width=6)
    return image


def run_tray(run_flask) -> None:
    threading.Thread(target=run_flask, name="monitor-ui", daemon=True).start()
    agent.start_agent()
    time.sleep(0.5)

    def open_ui(_icon=None, _item=None):
        webbrowser.open(f"{UI_URL}/config")

    def restart(_icon=None, _item=None):
        agent.restart_agent()

    def exit_agent(icon, _item=None):
        agent.stop_agent()
        icon.stop()

    def status(_item=None):
        state = agent.get_state()
        if state.get("connected") and state.get("authenticated"):
            return "Status: conectado"
        if state.get("socket_open"):
            return "Status: socket aberto (aguardando auth)"
        return "Status: desconectado"

    icon = pystray.Icon(
        "ComputicketMonitorAgent",
        _icon_image(),
        "Computicket Monitor Agent",
        pystray.Menu(
            pystray.MenuItem("Abrir interface", open_ui, default=True),
            pystray.MenuItem(status, None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Reiniciar agente", restart),
            pystray.MenuItem("Sair", exit_agent),
        ),
    )

    def refresh() -> None:
        while getattr(icon, "visible", False):
            icon.update_menu()
            time.sleep(3)

    threading.Thread(target=refresh, name="tray-refresh", daemon=True).start()
    icon.run()
