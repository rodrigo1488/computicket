"""Geração de PDF de orçamentos (builder) com ReportLab."""
import io

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
	Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
)

from ..format_utils import format_brl as _brl
from ..rich_text_utils import html_to_reportlab, rich_text_has_content


def _safe_color(hex_color: str, fallback: str) -> colors.Color:
	try:
		return colors.HexColor(hex_color)
	except Exception:
		return colors.HexColor(fallback)


def generate_budget_pdf(budget, logo_path: str = None) -> io.BytesIO:
	"""Gera o PDF de um orçamento e retorna um BytesIO pronto para envio."""
	theme = budget.get_theme_colors()
	primary = _safe_color(theme["primary"], "#2563eb")
	accent = _safe_color(theme["accent"], "#0ea5e9")
	text_color = _safe_color(theme["text"], "#1e293b")
	title_color = _safe_color(theme["title"], "#ffffff")

	buffer = io.BytesIO()
	doc = SimpleDocTemplate(
		buffer,
		pagesize=A4,
		leftMargin=18 * mm,
		rightMargin=18 * mm,
		topMargin=16 * mm,
		bottomMargin=16 * mm,
		title=f"Orçamento - {budget.title}",
	)

	styles = getSampleStyleSheet()
	style_title = ParagraphStyle(
		"BudgetTitle", parent=styles["Title"], textColor=title_color,
		fontSize=18, leading=22, alignment=0, spaceAfter=0,
	)
	style_header_info = ParagraphStyle(
		"HeaderInfo", parent=styles["Normal"], textColor=title_color,
		fontSize=9, leading=12,
	)
	style_label = ParagraphStyle(
		"Label", parent=styles["Normal"], textColor=colors.HexColor("#64748b"),
		fontSize=8, leading=10,
	)
	style_value = ParagraphStyle(
		"Value", parent=styles["Normal"], textColor=text_color,
		fontSize=10, leading=13,
	)
	style_body = ParagraphStyle(
		"Body", parent=styles["Normal"], textColor=text_color,
		fontSize=9, leading=12,
	)
	style_total = ParagraphStyle(
		"TotalValue", parent=styles["Normal"], textColor=primary,
		fontSize=13, leading=16, alignment=TA_RIGHT, fontName="Helvetica-Bold",
	)

	elements = []

	# Cabeçalho: faixa na cor primária com logo (opcional) + título
	header_left = []
	if logo_path:
		try:
			logo = Image(logo_path)
			max_w, max_h = 45 * mm, 20 * mm
			ratio = min(max_w / logo.imageWidth, max_h / logo.imageHeight, 1)
			logo.drawWidth = logo.imageWidth * ratio
			logo.drawHeight = logo.imageHeight * ratio
			header_left.append(logo)
		except Exception:
			pass

	created = budget.created_at.strftime("%d/%m/%Y") if budget.created_at else "-"
	header_right = [
		Paragraph("ORÇAMENTO", style_header_info),
		Paragraph(budget.title, style_title),
		Spacer(1, 2 * mm),
		Paragraph(f"Nº {budget.id or '-'} &nbsp;•&nbsp; Emitido em {created}", style_header_info),
	]

	if header_left:
		header_table = Table(
			[[header_left, header_right]],
			colWidths=[55 * mm, None],
		)
	else:
		header_table = Table([[header_right]], colWidths=[None])
	header_table.setStyle(TableStyle([
		("BACKGROUND", (0, 0), (-1, -1), primary),
		("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
		("TOPPADDING", (0, 0), (-1, -1), 8),
		("BOTTOMPADDING", (0, 0), (-1, -1), 8),
		("LEFTPADDING", (0, 0), (-1, -1), 10),
		("RIGHTPADDING", (0, 0), (-1, -1), 10),
	]))
	elements.append(header_table)
	elements.append(Spacer(1, 6 * mm))

	# Bloco cliente / validade / status
	valid_until = budget.valid_until.strftime("%d/%m/%Y") if budget.valid_until else "Sem validade definida"
	info_table = Table([
		[
			[Paragraph("CLIENTE", style_label), Paragraph(budget.get_client_name(), style_value)],
			[Paragraph("VÁLIDO ATÉ", style_label), Paragraph(valid_until, style_value)],
			[Paragraph("STATUS", style_label), Paragraph(budget.get_status_text(), style_value)],
		]
	], colWidths=[None, 45 * mm, 35 * mm])
	info_table.setStyle(TableStyle([
		("VALIGN", (0, 0), (-1, -1), "TOP"),
		("LINEBELOW", (0, 0), (-1, -1), 0.75, accent),
		("BOTTOMPADDING", (0, 0), (-1, -1), 6),
		("LEFTPADDING", (0, 0), (0, -1), 0),
	]))
	elements.append(info_table)
	elements.append(Spacer(1, 4 * mm))

	if budget.description:
		desc_html = html_to_reportlab(budget.description)
		if not desc_html and budget.description:
			desc_html = budget.description.replace("\n", "<br/>")
		elements.append(Paragraph(desc_html, style_body))
		elements.append(Spacer(1, 4 * mm))

	style_obs = ParagraphStyle(
		"ItemObs", parent=styles["Normal"], textColor=colors.HexColor("#64748b"),
		fontSize=8, leading=10, leftIndent=8,
	)

	# Tabela de itens
	items = list(budget.items)
	item_rows = [["#", "Tipo", "Descrição", "Qtd", "Valor Unit.", "Total"]]
	for index, item in enumerate(items, start=1):
		quantity = item.quantity or 0
		quantity_text = f"{quantity:g}"
		if item.unit_of_measure:
			quantity_text += f" {item.unit_of_measure}"
		desc_parts = [html_to_reportlab(item.description) or item.description]
		if item.codigo:
			desc_parts.append(f"(Cód: {item.codigo})")
		type_text = item.type_label
		if getattr(item, "is_recurring", False):
			rec_label = getattr(item, "recurrence_label", None) or "Mensal"
			type_text = f"{type_text}\n({rec_label})"
		total_text = _brl(item.total)
		if getattr(item, "is_recurring", False):
			period = getattr(item, "recurrence_period", None) or "monthly"
			suffix = {"monthly": "/mês", "quarterly": "/trim.", "yearly": "/ano"}.get(period, "/mês")
			total_text = f"{total_text}\n{suffix}"
		item_rows.append([
			str(index),
			type_text,
			Paragraph("<br/>".join(desc_parts), style_body),
			quantity_text,
			_brl(item.unit_price or 0),
			total_text,
		])
		if item.observations and rich_text_has_content(item.observations):
			obs_html = html_to_reportlab(item.observations)
			item_rows.append([
				"",
				"",
				Paragraph(f"<i>Obs: {obs_html}</i>", style_obs),
				"", "", "",
			])
	if not items:
		item_rows.append(["-", "-", Paragraph("Nenhum item informado", style_body), "-", "-", "-"])

	items_table = Table(item_rows, colWidths=[10 * mm, 18 * mm, None, 18 * mm, 30 * mm, 30 * mm], repeatRows=1)
	items_table.setStyle(TableStyle([
		("BACKGROUND", (0, 0), (-1, 0), primary),
		("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
		("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
		("FONTSIZE", (0, 0), (-1, -1), 9),
		("TEXTCOLOR", (0, 1), (-1, -1), text_color),
		("ALIGN", (0, 0), (0, -1), "CENTER"),
		("ALIGN", (2, 0), (-1, -1), "RIGHT"),
		("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
		("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
		("LINEBELOW", (0, -1), (-1, -1), 0.75, accent),
		("TOPPADDING", (0, 0), (-1, -1), 5),
		("BOTTOMPADDING", (0, 0), (-1, -1), 5),
	]))
	elements.append(items_table)
	elements.append(Spacer(1, 4 * mm))

	# Totais
	totals_rows = [[Paragraph("Subtotal (único)", style_body), Paragraph(_brl(budget.subtotal), style_body)]]
	recurring = getattr(budget, "recurring_totals_by_period", {}) or {}
	period_labels = {
		"monthly": ("Recorrente (mensal)", "/mês"),
		"quarterly": ("Recorrente (trimestral)", "/trim."),
		"yearly": ("Recorrente (anual)", "/ano"),
	}
	for period_key in ("monthly", "quarterly", "yearly"):
		amount = recurring.get(period_key) or 0
		if amount:
			label, suffix = period_labels[period_key]
			totals_rows.append([
				Paragraph(label, style_body),
				Paragraph(f"{_brl(amount)} {suffix}", style_body),
			])
	if budget.discount:
		totals_rows.append([
			Paragraph("Desconto", style_body),
			Paragraph(f"- {_brl(budget.discount)}", style_body),
		])
	totals_rows.append([
		Paragraph("<b>TOTAL (único)</b>", style_value),
		Paragraph(_brl(budget.total), style_total),
	])
	totals_table = Table(totals_rows, colWidths=[None, 40 * mm], hAlign="RIGHT")
	totals_table.setStyle(TableStyle([
		("ALIGN", (1, 0), (1, -1), "RIGHT"),
		("LINEABOVE", (0, -1), (-1, -1), 1, primary),
		("TOPPADDING", (0, 0), (-1, -1), 3),
		("BOTTOMPADDING", (0, 0), (-1, -1), 3),
	]))
	elements.append(totals_table)

	# Condições de pagamento / observações (não inclui internal_notes — uso interno)
	if budget.payment_terms and rich_text_has_content(budget.payment_terms):
		elements.append(Spacer(1, 6 * mm))
		elements.append(Paragraph("<b>Condições e observações</b>", style_value))
		elements.append(Spacer(1, 1.5 * mm))
		terms_html = html_to_reportlab(budget.payment_terms)
		if not terms_html:
			terms_html = budget.payment_terms.replace("\n", "<br/>")
		elements.append(Paragraph(terms_html, style_body))

	# Rodapé
	elements.append(Spacer(1, 10 * mm))
	footer_style = ParagraphStyle(
		"Footer", parent=styles["Normal"], textColor=colors.HexColor("#94a3b8"),
		fontSize=8, leading=10,
	)
	elements.append(Paragraph(
		"Este documento é um orçamento e não representa comprovante fiscal. "
		"Valores sujeitos a alteração após a data de validade.",
		footer_style,
	))

	doc.build(elements)
	buffer.seek(0)
	return buffer
