from flask import Blueprint, render_template, jsonify, request
from app.models import System, Plan


bp = Blueprint("catalog", __name__)


@bp.route("/")
def catalog_index():
    """Página pública para clientes visualizarem sistemas e planos."""
    systems = System.query.filter_by(is_active=True).order_by(System.name.asc()).all()
    return render_template("public/catalog.html", systems=systems)


@bp.route("/sistema/<int:system_id>")
def catalog_system_plans(system_id: int):
    """Página pública com os planos detalhados de um sistema, separados por suporte incluso."""
    system = System.query.filter_by(id=system_id, is_active=True).first()
    if not system:
        return render_template("public/system_not_found.html"), 404

    plans = (
        Plan.query.filter(Plan.system_id == system_id, Plan.is_active == True)
        .order_by(Plan.is_featured.desc(), Plan.support_included.desc(), Plan.monthly_value.asc())
        .all()
    )

    plans_with_support = [p for p in plans if p.support_included]
    plans_without_support = [p for p in plans if not p.support_included]

    return render_template(
        "public/system_plans.html",
        system=system,
        plans_with_support=plans_with_support,
        plans_without_support=plans_without_support,
    )


@bp.route("/api/systems")
def api_systems():
    """Lista sistemas ativos (público)."""
    systems = System.query.filter_by(is_active=True).order_by(System.name.asc()).all()
    return jsonify([
        {
            "id": s.id,
            "name": s.name,
            "description": s.description,
            "logo_url": s.logo_url,
            "active_plans": len([p for p in s.plans if p.is_active]),
        }
        for s in systems
    ])


@bp.route("/api/plans")
def api_plans():
    """Lista planos ativos de um sistema (público)."""
    system_id = request.args.get("system_id", type=int)
    if not system_id:
        return jsonify({"error": "Parâmetro system_id é obrigatório"}), 400

    plans = (
        Plan.query.filter(Plan.system_id == system_id, Plan.is_active == True)
        .order_by(Plan.is_featured.desc(), Plan.monthly_value.asc())
        .all()
    )

    return jsonify([
        {
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "monthly_hours": p.monthly_hours,
            "additional_hour_rate": p.additional_hour_rate,
            "includes_remote_support": p.includes_remote_support,
            "includes_on_site_support": p.includes_on_site_support,
            "includes_phone_support": p.includes_phone_support,
            "includes_email_support": p.includes_email_support,
            "support_included": p.support_included,
            "response_time_hours": p.response_time_hours,
            "resolution_time_hours": p.resolution_time_hours,
            "priority_level": p.priority_level,
            "monthly_value": p.monthly_value,
            "setup_fee": p.setup_fee,
            "is_featured": p.is_featured,
        }
        for p in plans
    ])


