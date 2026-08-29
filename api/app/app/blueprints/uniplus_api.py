"""API HTTP auxiliar para jobs Uniplus (status / enqueue admin)."""
from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user

from ..models import UniplusJob
from ..uniplus_jobs import (
	agent_enabled,
	connected_count,
	connected_device_ids,
	enqueue_uniplus_job,
	expected_device_id,
	get_agent_settings,
	save_agent_settings,
)

bp = Blueprint("uniplus_api", __name__, url_prefix="/api/uniplus")


def _require_admin():
	if not current_user.has_role("admin"):
		return jsonify({"error": "Acesso negado"}), 403
	return None


@bp.get("/status")
@login_required
def status():
	return jsonify({
		"agent_enabled": agent_enabled(),
		"connected_agents": connected_count(),
		"connected_devices": connected_device_ids(),
		"device_id_configured": bool(expected_device_id()),
		"pending": UniplusJob.query.filter_by(status="pending").count(),
		"running": UniplusJob.query.filter_by(status="running").count(),
	})


@bp.get("/config")
@login_required
def get_config():
	denied = _require_admin()
	if denied:
		return denied
	return jsonify(get_agent_settings())


@bp.put("/config")
@login_required
def put_config():
	denied = _require_admin()
	if denied:
		return denied
	data = request.get_json(silent=True) or {}
	enabled = data.get("enabled")
	if enabled is not None and not isinstance(enabled, bool):
		# aceita "1"/"true"/0
		enabled = str(enabled).strip().lower() in {"1", "true", "yes", "on"}
	device_id = data.get("device_id")
	if device_id is not None:
		device_id = str(device_id)
	token = data.get("token")
	if token is not None:
		token = str(token)

	pg = data.get("pg") if isinstance(data.get("pg"), dict) else {}
	has_pg = "pg" in data or any(
		k in data for k in (
			"pg_host", "pg_port", "pg_database", "pg_user", "pg_password", "pg_connect_timeout",
		)
	)
	pg_host = data.get("pg_host", pg.get("host")) if has_pg else None
	pg_port = data.get("pg_port", pg.get("port")) if has_pg else None
	pg_database = data.get("pg_database", pg.get("database")) if has_pg else None
	pg_user = data.get("pg_user", pg.get("user")) if has_pg else None
	pg_password = data.get("pg_password", pg.get("password")) if has_pg else None
	pg_connect_timeout = data.get("pg_connect_timeout", pg.get("connect_timeout")) if has_pg else None

	try:
		settings = save_agent_settings(
			enabled=enabled if "enabled" in data else None,
			device_id=device_id if "device_id" in data else None,
			token=token if "token" in data else None,
			pg_host=str(pg_host) if pg_host is not None else None,
			pg_port=pg_port,
			pg_database=str(pg_database) if pg_database is not None else None,
			pg_user=str(pg_user) if pg_user is not None else None,
			pg_password=str(pg_password) if pg_password is not None else None,
			pg_connect_timeout=pg_connect_timeout,
		)
	except Exception as e:
		return jsonify({"error": str(e)}), 500
	return jsonify(settings)


@bp.get("/jobs/<int:job_id>")
@login_required
def get_job(job_id: int):
	job = UniplusJob.query.get_or_404(job_id)
	return jsonify(job.to_dict())


@bp.post("/jobs")
@login_required
def create_job():
	"""Enqueue manual (admin/debug). Body: { job_type, payload }."""
	if not current_user.has_role("admin"):
		return jsonify({"error": "Apenas admin"}), 403
	data = request.get_json(silent=True) or {}
	job_type = (data.get("job_type") or "").strip()
	if not job_type:
		return jsonify({"error": "job_type obrigatório"}), 400
	payload = data.get("payload") or {}
	if not isinstance(payload, dict):
		return jsonify({"error": "payload deve ser objeto"}), 400
	job = enqueue_uniplus_job(job_type, payload)
	return jsonify(job.to_dict()), 201
