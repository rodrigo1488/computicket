"""Módulo para geração de PDF da Duplicata de Venda Mercantil (Venda Avulsa / Produto Fora de Estoque)."""

from io import BytesIO
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT


def _converte_grupo(n: int) -> str:
	UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"]
	DEZENAS = ["", "dez", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
	TEENS = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
	CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"]
	if n == 0: return ""
	if n == 100: return "cem"
	c, d, u = n // 100, (n % 100) // 10, n % 10
	res = []
	if c > 0: res.append(CENTENAS[c])
	if d == 1: res.append(TEENS[u])
	else:
		if d > 1: res.append(DEZENAS[d])
		if u > 0: res.append(UNIDADES[u])
	return " e ".join(res)


def valor_por_extenso(valor: float) -> str:
	if valor <= 0: return "Zero reais"
	inteiro = int(round(valor, 2))
	centavos = int(round((round(valor, 2) - inteiro) * 100))
	if centavos < 0: centavos = 0
	partes = []
	milhar, unidade = (inteiro // 1000) % 1000, inteiro % 1000
	if milhar > 0:
		partes.append("um mil" if milhar == 1 else _converte_grupo(milhar) + " mil")
	if unidade > 0:
		ext_u = _converte_grupo(unidade)
		if ext_u: partes.append(ext_u)
	str_reais = " e ".join(partes) if partes else ""
	moeda = "real" if inteiro == 1 else "reais"
	texto_reais = f"{str_reais} {moeda}" if str_reais else ""
	if centavos > 0:
		ext_c = _converte_grupo(centavos)
		moeda_c = "centavo" if centavos == 1 else "centavos"
		texto_centavos = f"{ext_c} {moeda_c}"
		full = f"{texto_reais} e {texto_centavos}" if texto_reais else texto_centavos
	else:
		full = texto_reais
	return full.capitalize() if full else "Zero reais"


def build_duplicata_pdf(data: dict) -> BytesIO:
	"""
	Gera o buffer PDF da Duplicata de Venda Mercantil idêntico ao modelo físico.
	"""
	buffer = BytesIO()
	doc = SimpleDocTemplate(
		buffer,
		pagesize=A4,
		leftMargin=10 * mm,
		rightMargin=10 * mm,
		topMargin=10 * mm,
		bottomMargin=10 * mm,
	)

	styles = getSampleStyleSheet()
	title_style = ParagraphStyle('CompTitle', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=12, leading=14, alignment=TA_CENTER)
	header_style = ParagraphStyle('HeaderTxt', parent=styles['Normal'], fontName='Helvetica', fontSize=8.5, leading=11)
	bold_style = ParagraphStyle('BoldTxt', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=8.5, leading=11)
	center_bold = ParagraphStyle('CBoldTxt', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=8.5, leading=11, alignment=TA_CENTER)
	small_style = ParagraphStyle('SmallTxt', parent=styles['Normal'], fontName='Helvetica', fontSize=8, leading=10)

	elements = []

	# 1. Cabeçalho da Empresa
	comp_header = [
		[Paragraph("Compumais Informática Ltda", title_style), ""],
		[
			Paragraph("<b>Endereço:</b> AV. CORONEL JOSE AFONSO DE ALMEIDA, 53<br/><b>Cidade:</b> SACRAMENTO<br/><b>CNPJ:</b> 10.579.611/0001-90<br/><b>Insc. Est.:</b> 0011058410008", header_style),
			Paragraph(f"<b>CEP:</b> 38190-000<br/><b>UF:</b> MG<br/><b>Fone:</b> (0xx34)3351-1861<br/><b>Data de emissão:</b> {data.get('emissao', '')}", header_style)
		]
	]
	t_comp = Table(comp_header, colWidths=[110 * mm, 80 * mm])
	t_comp.setStyle(TableStyle([
		('SPAN', (0, 0), (1, 0)),
		('ALIGN', (0, 0), (1, 0), 'CENTER'),
		('BOTTOMPADDING', (0, 0), (1, 0), 6),
		('TOPPADDING', (0, 0), (-1, -1), 2),
		('BOTTOMPADDING', (0, 0), (-1, -1), 2),
	]))
	elements.append(t_comp)
	elements.append(Spacer(1, 4 * mm))

	# 2. Tabela FATURA / DUPLICATA / VENCIMENTO
	fatura_table_data = [
		[Paragraph("FATURA", center_bold), "", Paragraph("DUPLICATA", center_bold), "", Paragraph("VENCIMENTO", center_bold)],
		[Paragraph("Valor R$", bold_style), Paragraph("Número", bold_style), Paragraph("Valor R$", bold_style), Paragraph("Número", bold_style), ""],
		[Paragraph("", header_style), Paragraph("", header_style), Paragraph(f"{data.get('valor', 0.0):,.2f}".replace('.',','), header_style), Paragraph(data.get('documento', ''), header_style), Paragraph(data.get('vencimento', ''), center_bold)]
	]
	t_fatura = Table(fatura_table_data, colWidths=[30 * mm, 30 * mm, 35 * mm, 55 * mm, 40 * mm])
	t_fatura.setStyle(TableStyle([
		('SPAN', (0, 0), (1, 0)),
		('SPAN', (2, 0), (3, 0)),
		('SPAN', (4, 0), (4, 1)),
		('GRID', (0, 0), (-1, -1), 0.8, colors.black),
		('ALIGN', (0, 0), (-1, -1), 'CENTER'),
		('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
		('TOPPADDING', (0, 0), (-1, -1), 3),
		('BOTTOMPADDING', (0, 0), (-1, -1), 3),
	]))
	elements.append(t_fatura)
	elements.append(Spacer(1, 4 * mm))

	# 3. Box Sacado / Cliente
	sacado_data = [
		[Paragraph(f"<b>Sacado:</b> {data.get('cliente_nome', '')}", header_style), Paragraph(f"<b>Fone:</b> {data.get('cliente_fone', '')}", header_style)],
		[Paragraph(f"<b>Endereço:</b> {data.get('cliente_endereco', '')}", header_style), Paragraph(f"<b>Bairro:</b> {data.get('cliente_bairro', '')}", header_style)],
		[Paragraph(f"<b>Município:</b> {data.get('cliente_cidade', '')}", header_style), Paragraph(f"<b>CEP:</b> {data.get('cliente_cep', '')} &nbsp;&nbsp;&nbsp;&nbsp; <b>UF:</b> {data.get('cliente_uf', '')}", header_style)],
		[Paragraph(f"<b>CNPJ/CPF:</b> {data.get('cliente_doc', '')}", header_style), Paragraph(f"<b>I.E:</b> {data.get('cliente_ie', '')}", header_style)],
		[Paragraph(f"<b>Praça pagto:</b> {data.get('cliente_cidade', '')}", header_style), ""]
	]
	t_sacado = Table(sacado_data, colWidths=[120 * mm, 70 * mm])
	t_sacado.setStyle(TableStyle([
		('SPAN', (0, 4), (1, 4)),
		('BOX', (0, 0), (-1, -1), 0.8, colors.black),
		('INNERGRID', (0, 0), (-1, -1), 0.4, colors.lightgrey),
		('TOPPADDING', (0, 0), (-1, -1), 3),
		('BOTTOMPADDING', (0, 0), (-1, -1), 3),
	]))
	elements.append(t_sacado)
	elements.append(Spacer(1, 4 * mm))

	# 4. Valor por Extenso
	val_ext = valor_por_extenso(data.get('valor', 0.0))
	extenso_data = [
		[Paragraph("<b>Valor por<br/>extenso</b>", header_style), Paragraph(f"<b>{val_ext}</b>", header_style)]
	]
	t_extenso = Table(extenso_data, colWidths=[25 * mm, 165 * mm])
	t_extenso.setStyle(TableStyle([
		('BOX', (0, 0), (-1, -1), 0.8, colors.black),
		('INNERGRID', (0, 0), (-1, -1), 0.8, colors.black),
		('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
		('TOPPADDING', (0, 0), (-1, -1), 4),
		('BOTTOMPADDING', (0, 0), (-1, -1), 4),
	]))
	elements.append(t_extenso)
	elements.append(Spacer(1, 4 * mm))

	# 5. Declaração + Observação / Itens + Vendedor + Assinaturas
	decl_text = "Reconheço(emos) a exatidão desta DUPLICATA DE VENDA MERCANTIL na importância que pagarei(emos) à Compumais Informática Ltda ou à sua ordem na praça e vencimento acima indicados"
	obs_text = f"<b>Observação:</b> {data.get('obs', '')}"
	vend_text = f"<b>Vendedor:</b> {data.get('vendedor', '')}"

	sig_lines = [
		[
			Paragraph("____________________________________________________<br/><b>Assinatura do Cliente</b>", ParagraphStyle('SigClient', parent=small_style, alignment=TA_CENTER))
		]
	]
	t_sig = Table(sig_lines, colWidths=[190 * mm])
	t_sig.setStyle(TableStyle([
		('ALIGN', (0, 0), (-1, -1), 'CENTER'),
		('TOPPADDING', (0, 0), (-1, -1), 2),
		('BOTTOMPADDING', (0, 0), (-1, -1), 2),
	]))

	body_box_data = [
		[Paragraph(decl_text, header_style)],
		[Spacer(1, 3 * mm)],
		[Paragraph(obs_text, header_style)],
		[Paragraph(vend_text, header_style)],
		[Spacer(1, 8 * mm)],
		[t_sig]
	]
	t_body_box = Table(body_box_data, colWidths=[190 * mm])
	t_body_box.setStyle(TableStyle([
		('BOX', (0, 0), (-1, -1), 0.8, colors.black),
		('TOPPADDING', (0, 0), (-1, -1), 4),
		('BOTTOMPADDING', (0, 0), (-1, -1), 4),
		('LEFTPADDING', (0, 0), (-1, -1), 6),
		('RIGHTPADDING', (0, 0), (-1, -1), 6),
	]))
	elements.append(t_body_box)

	doc.build(elements)
	buffer.seek(0)
	return buffer


def build_duplicata_pdf_list(data_list: list[dict]) -> BytesIO:
	"""
	Gera o buffer PDF contendo múltiplas páginas de Duplicatas de Venda Mercantil.
	"""
	buffer = BytesIO()
	doc = SimpleDocTemplate(
		buffer,
		pagesize=A4,
		leftMargin=10 * mm,
		rightMargin=10 * mm,
		topMargin=10 * mm,
		bottomMargin=10 * mm,
	)

	styles = getSampleStyleSheet()
	title_style = ParagraphStyle('CompTitle', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=12, leading=14, alignment=TA_CENTER)
	header_style = ParagraphStyle('HeaderTxt', parent=styles['Normal'], fontName='Helvetica', fontSize=8.5, leading=11)
	bold_style = ParagraphStyle('BoldTxt', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=8.5, leading=11)
	center_bold = ParagraphStyle('CBoldTxt', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=8.5, leading=11, alignment=TA_CENTER)
	small_style = ParagraphStyle('SmallTxt', parent=styles['Normal'], fontName='Helvetica', fontSize=8, leading=10)

	elements = []

	for idx, data in enumerate(data_list):
		if idx > 0:
			elements.append(PageBreak())

		# 1. Cabeçalho da Empresa
		comp_header = [
			[Paragraph("Compumais Informática Ltda", title_style), ""],
			[
				Paragraph("<b>Endereço:</b> AV. CORONEL JOSE AFONSO DE ALMEIDA, 53<br/><b>Cidade:</b> SACRAMENTO<br/><b>CNPJ:</b> 10.579.611/0001-90<br/><b>Insc. Est.:</b> 0011058410008", header_style),
				Paragraph(f"<b>CEP:</b> 38190-000<br/><b>UF:</b> MG<br/><b>Fone:</b> (0xx34)3351-1861<br/><b>Data de emissão:</b> {data.get('emissao', '')}", header_style)
			]
		]
		t_comp = Table(comp_header, colWidths=[110 * mm, 80 * mm])
		t_comp.setStyle(TableStyle([
			('SPAN', (0, 0), (1, 0)),
			('ALIGN', (0, 0), (1, 0), 'CENTER'),
			('BOTTOMPADDING', (0, 0), (1, 0), 6),
			('TOPPADDING', (0, 0), (-1, -1), 2),
			('BOTTOMPADDING', (0, 0), (-1, -1), 2),
		]))
		elements.append(t_comp)
		elements.append(Spacer(1, 4 * mm))

		# 2. Tabela FATURA / DUPLICATA / VENCIMENTO
		fatura_table_data = [
			[Paragraph("FATURA", center_bold), "", Paragraph("DUPLICATA", center_bold), "", Paragraph("VENCIMENTO", center_bold)],
			[Paragraph("Valor R$", bold_style), Paragraph("Número", bold_style), Paragraph("Valor R$", bold_style), Paragraph("Número", bold_style), ""],
			[Paragraph("", header_style), Paragraph("", header_style), Paragraph(f"{data.get('valor', 0.0):,.2f}".replace('.',','), header_style), Paragraph(data.get('documento', ''), header_style), Paragraph(data.get('vencimento', ''), center_bold)]
		]
		t_fatura = Table(fatura_table_data, colWidths=[30 * mm, 30 * mm, 35 * mm, 55 * mm, 40 * mm])
		t_fatura.setStyle(TableStyle([
			('SPAN', (0, 0), (1, 0)),
			('SPAN', (2, 0), (3, 0)),
			('SPAN', (4, 0), (4, 1)),
			('GRID', (0, 0), (-1, -1), 0.8, colors.black),
			('ALIGN', (0, 0), (-1, -1), 'CENTER'),
			('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
			('TOPPADDING', (0, 0), (-1, -1), 3),
			('BOTTOMPADDING', (0, 0), (-1, -1), 3),
		]))
		elements.append(t_fatura)
		elements.append(Spacer(1, 4 * mm))

		# 3. Box Sacado / Cliente
		sacado_data = [
			[Paragraph(f"<b>Sacado:</b> {data.get('cliente_nome', '')}", header_style), Paragraph(f"<b>Fone:</b> {data.get('cliente_fone', '')}", header_style)],
			[Paragraph(f"<b>Endereço:</b> {data.get('cliente_endereco', '')}", header_style), Paragraph(f"<b>Bairro:</b> {data.get('cliente_bairro', '')}", header_style)],
			[Paragraph(f"<b>Município:</b> {data.get('cliente_cidade', '')}", header_style), Paragraph(f"<b>CEP:</b> {data.get('cliente_cep', '')} &nbsp;&nbsp;&nbsp;&nbsp; <b>UF:</b> {data.get('cliente_uf', '')}", header_style)],
			[Paragraph(f"<b>CNPJ/CPF:</b> {data.get('cliente_doc', '')}", header_style), Paragraph(f"<b>I.E:</b> {data.get('cliente_ie', '')}", header_style)],
			[Paragraph(f"<b>Praça pagto:</b> {data.get('cliente_cidade', '')}", header_style), ""]
		]
		t_sacado = Table(sacado_data, colWidths=[120 * mm, 70 * mm])
		t_sacado.setStyle(TableStyle([
			('SPAN', (0, 4), (1, 4)),
			('BOX', (0, 0), (-1, -1), 0.8, colors.black),
			('INNERGRID', (0, 0), (-1, -1), 0.4, colors.lightgrey),
			('TOPPADDING', (0, 0), (-1, -1), 3),
			('BOTTOMPADDING', (0, 0), (-1, -1), 3),
		]))
		elements.append(t_sacado)
		elements.append(Spacer(1, 4 * mm))

		# 4. Valor por Extenso
		val_ext = valor_por_extenso(data.get('valor', 0.0))
		extenso_data = [
			[Paragraph("<b>Valor por<br/>extenso</b>", header_style), Paragraph(f"<b>{val_ext}</b>", header_style)]
		]
		t_extenso = Table(extenso_data, colWidths=[25 * mm, 165 * mm])
		t_extenso.setStyle(TableStyle([
			('BOX', (0, 0), (-1, -1), 0.8, colors.black),
			('INNERGRID', (0, 0), (-1, -1), 0.8, colors.black),
			('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
			('TOPPADDING', (0, 0), (-1, -1), 4),
			('BOTTOMPADDING', (0, 0), (-1, -1), 4),
		]))
		elements.append(t_extenso)
		elements.append(Spacer(1, 4 * mm))

		# 5. Declaração + Observação / Itens + Vendedor + Assinaturas
		decl_text = "Reconheço(emos) a exatidão desta DUPLICATA DE VENDA MERCANTIL na importância que pagarei(emos) à Compumais Informática Ltda ou à sua ordem na praça e vencimento acima indicados"
		obs_text = f"<b>Observação:</b> {data.get('obs', '')}"
		vend_text = f"<b>Vendedor:</b> {data.get('vendedor', '')}"

		sig_lines = [
			[
				Paragraph("____________________________________________________<br/><b>Assinatura do Cliente</b>", ParagraphStyle('SigClient', parent=small_style, alignment=TA_CENTER))
			]
		]
		t_sig = Table(sig_lines, colWidths=[190 * mm])
		t_sig.setStyle(TableStyle([
			('ALIGN', (0, 0), (-1, -1), 'CENTER'),
			('TOPPADDING', (0, 0), (-1, -1), 2),
			('BOTTOMPADDING', (0, 0), (-1, -1), 2),
		]))

		body_box_data = [
			[Paragraph(decl_text, header_style)],
			[Spacer(1, 3 * mm)],
			[Paragraph(obs_text, header_style)],
			[Paragraph(vend_text, header_style)],
			[Spacer(1, 8 * mm)],
			[t_sig]
		]
		t_body_box = Table(body_box_data, colWidths=[190 * mm])
		t_body_box.setStyle(TableStyle([
			('BOX', (0, 0), (-1, -1), 0.8, colors.black),
			('TOPPADDING', (0, 0), (-1, -1), 4),
			('BOTTOMPADDING', (0, 0), (-1, -1), 4),
			('LEFTPADDING', (0, 0), (-1, -1), 6),
			('RIGHTPADDING', (0, 0), (-1, -1), 6),
		]))
		elements.append(t_body_box)

	doc.build(elements)
	buffer.seek(0)
	return buffer
