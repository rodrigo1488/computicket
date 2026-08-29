"""Módulo de inventário: itens com UUID, fotos e histórico de ações."""

from __future__ import annotations

import json
import os
import re
import uuid as uuid_lib
from typing import Any, Optional

from flask import (
    Blueprint,
    current_app,
    flash,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)
from flask_login import current_user, login_required
from werkzeug.utils import secure_filename
from sqlalchemy import or_

from .. import db
from ..models import InventoryEvent, InventoryItem, InventoryItemPhoto

bp = Blueprint("inventory", __name__)

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
MAX_FILE_SIZE = 8 * 1024 * 1024  # 8 MB por arquivo
MAX_PHOTOS_PER_ITEM = 20


def _upload_dir() -> str:
    folder = os.path.join(current_app.root_path, "uploads", "inventory")
    os.makedirs(folder, exist_ok=True)
    return folder


def _allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def _save_photos_for_item(item: InventoryItem, files) -> None:
    if not files:
        return
    file_list = files if isinstance(files, list) else [files]
    existing = InventoryItemPhoto.query.filter_by(item_id=item.id).count()
    for f in file_list:
        if not f or not getattr(f, "filename", None):
            continue
        if existing >= MAX_PHOTOS_PER_ITEM:
            flash(f"Limite de {MAX_PHOTOS_PER_ITEM} fotos por item.", "warning")
            break
        if not _allowed_file(f.filename):
            flash(f"Tipo de arquivo não permitido: {f.filename}", "warning")
            continue
        f.stream.seek(0, os.SEEK_END)
        size = f.stream.tell()
        f.stream.seek(0)
        if size > MAX_FILE_SIZE:
            flash(f"Arquivo muito grande: {f.filename}", "warning")
            continue
        orig = secure_filename(f.filename) or "foto.jpg"
        ext = orig.rsplit(".", 1)[-1].lower() if "." in orig else "jpg"
        stored = f"{uuid_lib.uuid4().hex}.{ext}"
        path = os.path.join(_upload_dir(), stored)
        f.save(path)
        rel = os.path.join("uploads", "inventory", stored).replace("\\", "/")
        photo = InventoryItemPhoto(
            item_id=item.id,
            stored_filename=stored,
            original_filename=orig,
            file_path=rel,
            file_size=size,
            sort_order=existing,
        )
        db.session.add(photo)
        existing += 1


def _delete_photo_record(photo: InventoryItemPhoto) -> None:
    full = os.path.join(current_app.root_path, photo.file_path.replace("/", os.sep))
    if os.path.isfile(full):
        try:
            os.remove(full)
        except OSError:
            pass
    db.session.delete(photo)


def _parse_meta_emprestimo() -> tuple[Optional[dict[str, Any]], Optional[str]]:
    cliente = (request.form.get("cliente_nome") or "").strip()
    if not cliente:
        return None, "Informe o nome do cliente para o empréstimo."
    data_emp = (request.form.get("data_emprestimo") or "").strip()
    data_prev = (request.form.get("data_prevista_devolucao") or "").strip()
    meta: dict[str, Any] = {"cliente_nome": cliente}
    if data_emp:
        meta["data_emprestimo"] = data_emp
    if data_prev:
        meta["data_prevista_devolucao"] = data_prev
    return meta, None


def _parse_meta_venda() -> tuple[Optional[dict[str, Any]], Optional[str]]:
    comprador = (request.form.get("comprador") or "").strip()
    if not comprador:
        return None, "Informe o comprador para a venda."
    meta: dict[str, Any] = {"comprador": comprador}
    valor_raw = (request.form.get("valor") or "").strip()
    if valor_raw:
        try:
            meta["valor"] = float(valor_raw.replace(",", "."))
        except ValueError:
            return None, "Valor inválido."
    data_v = (request.form.get("data_venda") or "").strip()
    if data_v:
        meta["data_venda"] = data_v
    return meta, None


def _parse_meta_descarte() -> tuple[Optional[dict[str, Any]], Optional[str]]:
    motivo = (request.form.get("motivo") or "").strip()
    if not motivo:
        return None, "Informe o motivo do descarte."
    meta: dict[str, Any] = {"motivo": motivo}
    data_d = (request.form.get("data_descarte") or "").strip()
    if data_d:
        meta["data_descarte"] = data_d
    return meta, None


def _parse_meta_devolucao() -> tuple[dict[str, Any], None]:
    return {}, None


def _apply_action(item: InventoryItem, action: str, note: str) -> tuple[bool, Optional[str]]:
    note = (note or "").strip()
    meta: Optional[dict[str, Any]] = None
    err: Optional[str] = None

    if item.status in (InventoryItem.STATUS_VENDIDO, InventoryItem.STATUS_DESCARTADO):
        return False, "Este item não permite novas ações (vendido ou descartado)."

    if action == InventoryEvent.ACTION_EMPRESTIMO:
        if item.status != InventoryItem.STATUS_DISPONIVEL:
            return False, "Empréstimo só é permitido quando o item está disponível."
        meta, err = _parse_meta_emprestimo()
        if err:
            return False, err
        item.status = InventoryItem.STATUS_EMPRESTADO

    elif action == InventoryEvent.ACTION_VENDA:
        if item.status not in (InventoryItem.STATUS_DISPONIVEL, InventoryItem.STATUS_EMPRESTADO):
            return False, "Venda não permitida para o estado atual."
        meta, err = _parse_meta_venda()
        if err:
            return False, err
        item.status = InventoryItem.STATUS_VENDIDO

    elif action == InventoryEvent.ACTION_DESCARTE:
        if item.status not in (InventoryItem.STATUS_DISPONIVEL, InventoryItem.STATUS_EMPRESTADO):
            return False, "Descarte não permitido para o estado atual."
        meta, err = _parse_meta_descarte()
        if err:
            return False, err
        item.status = InventoryItem.STATUS_DESCARTADO

    elif action == InventoryEvent.ACTION_DEVOLUCAO:
        if item.status != InventoryItem.STATUS_EMPRESTADO:
            return False, "Devolução só se aplica a itens emprestados."
        meta, _ = _parse_meta_devolucao()
        item.status = InventoryItem.STATUS_DISPONIVEL
    else:
        return False, "Ação inválida."

    ev = InventoryEvent(
        item_id=item.id,
        action_type=action,
        note=note or None,
        meta_json=json.dumps(meta, ensure_ascii=False) if meta else None,
        created_by_id=current_user.id,
    )
    db.session.add(ev)
    return True, None


@bp.route("/")
@login_required
def index():
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 20, type=int)
    per_page = max(5, min(100, per_page))
    q = (request.args.get("q") or "").strip()
    status_f = (request.args.get("status") or "").strip()

    query = InventoryItem.query
    if status_f and status_f in InventoryItem.STATUSES:
        query = query.filter(InventoryItem.status == status_f)
    if q:
        pattern = f"%{q}%"
        query = query.filter(
            or_(
                InventoryItem.description.ilike(pattern),
                InventoryItem.title.ilike(pattern),
                InventoryItem.serial_number.ilike(pattern),
                InventoryItem.public_uuid.ilike(pattern),
            )
        )
    query = query.order_by(InventoryItem.updated_at.desc(), InventoryItem.id.desc())
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    return render_template(
        "inventory/index.html",
        pagination=pagination,
        items=pagination.items,
        q=q,
        status_filter=status_f,
    )


@bp.route("/novo", methods=["GET", "POST"])
@login_required
def new_item():
    if request.method == "POST":
        title = (request.form.get("title") or "").strip()
        description = (request.form.get("description") or "").strip()
        serial_number = (request.form.get("serial_number") or "").strip()
        if not description:
            flash("A descrição é obrigatória.", "error")
            return render_template("inventory/form.html", item=None)
        item = InventoryItem(
            public_uuid=str(uuid_lib.uuid4()),
            title=title or None,
            description=description,
            serial_number=serial_number or None,
            status=InventoryItem.STATUS_DISPONIVEL,
            created_by_id=current_user.id,
        )
        db.session.add(item)
        db.session.flush()
        files = request.files.getlist("photos")
        _save_photos_for_item(item, files)
        db.session.commit()
        flash("Item cadastrado com sucesso.", "success")
        return redirect(url_for("inventory.detail", item_id=item.id))

    return render_template("inventory/form.html", item=None)


@bp.route("/<int:item_id>")
@login_required
def detail(item_id: int):
    item = InventoryItem.query.get_or_404(item_id)
    events = (
        InventoryEvent.query.filter_by(item_id=item.id)
        .order_by(InventoryEvent.created_at.desc())
        .all()
    )
    return render_template("inventory/detail.html", item=item, events=events)


@bp.route("/<int:item_id>/editar", methods=["GET", "POST"])
@login_required
def edit_item(item_id: int):
    item = InventoryItem.query.get_or_404(item_id)
    if request.method == "POST":
        title = (request.form.get("title") or "").strip()
        description = (request.form.get("description") or "").strip()
        serial_number = (request.form.get("serial_number") or "").strip()
        if not description:
            flash("A descrição é obrigatória.", "error")
            return render_template("inventory/form.html", item=item)
        item.title = title or None
        item.description = description
        item.serial_number = serial_number or None
        files = request.files.getlist("photos")
        _save_photos_for_item(item, files)
        db.session.commit()
        flash("Item atualizado.", "success")
        return redirect(url_for("inventory.detail", item_id=item.id))

    return render_template("inventory/form.html", item=item)


@bp.route("/<int:item_id>/excluir", methods=["POST"])
@login_required
def delete_item(item_id: int):
    item = InventoryItem.query.get_or_404(item_id)
    for photo in list(item.photos):
        _delete_photo_record(photo)
    db.session.delete(item)
    db.session.commit()
    flash("Item removido.", "success")
    return redirect(url_for("inventory.index"))


@bp.route("/<int:item_id>/foto/<int:photo_id>/excluir", methods=["POST"])
@login_required
def delete_photo(item_id: int, photo_id: int):
    item = InventoryItem.query.get_or_404(item_id)
    photo = InventoryItemPhoto.query.filter_by(id=photo_id, item_id=item.id).first_or_404()
    _delete_photo_record(photo)
    db.session.commit()
    flash("Foto removida.", "success")
    return redirect(url_for("inventory.detail", item_id=item.id))


@bp.route("/<int:item_id>/acao", methods=["POST"])
@login_required
def post_action(item_id: int):
    item = InventoryItem.query.get_or_404(item_id)
    action = (request.form.get("action_type") or "").strip()
    note = (request.form.get("note") or "").strip()

    if action not in InventoryEvent.ACTIONS:
        flash("Ação inválida.", "error")
        return redirect(url_for("inventory.detail", item_id=item.id))

    ok, err = _apply_action(item, action, note)
    if not ok:
        flash(err or "Não foi possível registrar a ação.", "error")
        return redirect(url_for("inventory.detail", item_id=item.id))

    db.session.commit()
    flash("Ação registrada.", "success")
    return redirect(url_for("inventory.detail", item_id=item.id))


@bp.route("/<int:item_id>/etiqueta")
@login_required
def label(item_id: int):
    item = InventoryItem.query.get_or_404(item_id)
    lookup_url = url_for("inventory.by_code", code=item.public_uuid, _external=True)
    return render_template("inventory/label.html", item=item, lookup_url=lookup_url)


_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)


@bp.route("/por-codigo/<code>")
@login_required
def by_code(code: str):
    code = (code or "").strip()
    if not _UUID_RE.match(code):
        flash("Código inválido.", "error")
        return redirect(url_for("inventory.index"))
    item = InventoryItem.query.filter(InventoryItem.public_uuid.ilike(code)).first()
    if not item:
        flash("Item não encontrado.", "error")
        return redirect(url_for("inventory.index"))
    return redirect(url_for("inventory.detail", item_id=item.id))


@bp.route("/foto-arquivo/<int:photo_id>")
@login_required
def serve_photo(photo_id: int):
    photo = InventoryItemPhoto.query.get_or_404(photo_id)
    directory = os.path.dirname(os.path.join(current_app.root_path, photo.file_path.replace("/", os.sep)))
    fname = photo.stored_filename
    return send_from_directory(directory, fname)
