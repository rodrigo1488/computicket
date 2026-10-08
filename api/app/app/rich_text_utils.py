"""Sanitização e conversão de HTML rico (orçamentos) para exibição, PDF e e-mail.

O HTML vindo do editor (Tiptap no Next ou o editor legado do Flask) é tratado como
NÃO CONFIÁVEL: nunca é repassado, e sim reconstruído a partir de uma whitelist de
tags/atributos/estilos. Todo texto é escapado e todo atributo é revalidado.

Texto puro legado (sem nenhuma tag) é convertido em parágrafos escapando caracteres e
preservando quebras de linha, sem migração destrutiva de dados.
"""
import re
from html import escape, unescape
from html.parser import HTMLParser
from io import StringIO
from typing import Optional

from markupsafe import Markup

# Tags que podem sobreviver à sanitização.
ALLOWED_TAGS = frozenset({
	# blocos
	"p", "div", "br", "hr", "blockquote", "pre",
	"h1", "h2", "h3", "h4", "h5", "h6",
	"ul", "ol", "li",
	# inline
	"b", "strong", "i", "em", "u", "s", "strike", "del", "mark", "sub", "sup",
	"code", "span", "font", "a",
})
VOID_TAGS = frozenset({"br", "hr"})
# Tags cujo CONTEÚDO também é descartado (não apenas a tag).
DROP_CONTENT_TAGS = frozenset({
	"script", "style", "iframe", "object", "embed", "noscript", "template", "title",
	"head", "svg", "math", "textarea", "select", "option", "button", "form", "applet",
	"frame", "frameset", "noframes", "xmp", "plaintext",
})
BLOCK_TAGS = frozenset({
	"p", "div", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "li",
})
ALLOWED_TEXT_ALIGN = frozenset({"left", "right", "center", "justify"})
ALLOWED_URL_SCHEMES = ("http://", "https://", "mailto:", "tel:")
NAMED_COLORS = frozenset({
	"black", "white", "gray", "grey", "silver", "maroon", "red", "purple", "fuchsia",
	"green", "lime", "olive", "yellow", "navy", "blue", "teal", "aqua", "orange",
	"transparent", "inherit",
})

HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
RGB_COLOR_RE = re.compile(
	r"^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$",
	re.I,
)
# Qualquer indício de marcação HTML (tag aberta/fechada ou comentário).
HTML_HINT_RE = re.compile(r"<\s*/?\s*[a-zA-Z!][^>]*>")
CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")


def _normalize_color(value: str) -> Optional[str]:
	"""Valida e normaliza uma cor CSS. Retorna None se não for segura/reconhecida."""
	value = (value or "").strip().lower()
	if not value:
		return None
	if HEX_COLOR_RE.match(value):
		return value
	match = RGB_COLOR_RE.match(value)
	if match:
		r, g, b = (min(255, int(match.group(i))) for i in (1, 2, 3))
		return "#{:02x}{:02x}{:02x}".format(r, g, b)
	if value in NAMED_COLORS:
		return value
	return None


def _clean_href(value: str) -> Optional[str]:
	"""Aceita apenas http/https/mailto/tel. Qualquer outra coisa (javascript:, data:...) é descartada."""
	href = CONTROL_CHARS_RE.sub("", value or "").strip()
	if not href:
		return None
	href = href.replace(" ", "%20")
	if not href.lower().startswith(ALLOWED_URL_SCHEMES):
		return None
	return href


def _clean_style(tag: str, style: str) -> str:
	"""Mantém somente color / background-color / text-align (blocos) com valores validados."""
	out = []
	for decl in (style or "").split(";"):
		if ":" not in decl:
			continue
		prop, _, val = decl.partition(":")
		prop = prop.strip().lower()
		val = val.strip()
		if prop in ("color", "background-color"):
			color = _normalize_color(val)
			if color:
				out.append(f"{prop}: {color}")
		elif prop == "text-align" and tag in BLOCK_TAGS:
			if val.lower() in ALLOWED_TEXT_ALIGN:
				out.append(f"text-align: {val.lower()}")
	return "; ".join(out)


class _RichHTMLSanitizer(HTMLParser):
	def __init__(self):
		super().__init__(convert_charrefs=True)
		self._out = StringIO()
		# pilha de (tag, emitida?) — tags removidas (ex.: <a> sem href válido) mantêm só o conteúdo
		self._stack: list[tuple[str, bool]] = []
		self._drop_depth = 0

	def handle_starttag(self, tag, attrs):
		tag = tag.lower()
		if tag in DROP_CONTENT_TAGS:
			if tag not in VOID_TAGS:
				self._drop_depth += 1
			return
		if self._drop_depth or tag not in ALLOWED_TAGS:
			return
		if tag in VOID_TAGS:
			self._out.write(f"<{tag}>")
			return
		attr_str = self._clean_attrs(tag, attrs)
		if tag == "a" and 'href="' not in attr_str:
			self._stack.append((tag, False))
			return
		self._out.write(f"<{tag}{attr_str}>")
		self._stack.append((tag, True))

	def handle_startendtag(self, tag, attrs):
		tag = tag.lower()
		if tag in VOID_TAGS:
			self.handle_starttag(tag, attrs)
			return
		# <span/> e similares: abre e fecha imediatamente
		self.handle_starttag(tag, attrs)
		self.handle_endtag(tag)

	def handle_endtag(self, tag):
		tag = tag.lower()
		if tag in DROP_CONTENT_TAGS:
			if self._drop_depth:
				self._drop_depth -= 1
			return
		if self._drop_depth or tag not in ALLOWED_TAGS or tag in VOID_TAGS:
			return
		# fecha apenas se houver abertura correspondente (end tag órfã é ignorada)
		if not any(open_tag == tag for open_tag, _ in self._stack):
			return
		while self._stack:
			open_tag, emitted = self._stack.pop()
			if emitted:
				self._out.write(f"</{open_tag}>")
			if open_tag == tag:
				break

	def handle_data(self, data):
		if self._drop_depth:
			return
		self._out.write(escape(data))

	def get_html(self) -> str:
		while self._stack:
			open_tag, emitted = self._stack.pop()
			if emitted:
				self._out.write(f"</{open_tag}>")
		return self._out.getvalue()

	def _clean_attrs(self, tag, attrs) -> str:
		parts = []
		for key, value in attrs:
			key = (key or "").lower()
			value = value or ""
			if key == "style":
				style = _clean_style(tag, value)
				if style:
					parts.append(("style", style))
			elif key == "color" and tag == "font":
				color = _normalize_color(value)
				if color:
					parts.append(("color", color))
			elif key == "href" and tag == "a":
				href = _clean_href(value)
				if href:
					parts.append(("href", href))
		if tag == "a" and any(k == "href" for k, _ in parts):
			parts.append(("target", "_blank"))
			parts.append(("rel", "noopener noreferrer"))
		return "".join(f' {k}="{escape(v, quote=True)}"' for k, v in parts)


def plain_text_to_html(text: str) -> str:
	"""Converte texto puro legado em HTML: escapa caracteres e preserva quebras de linha."""
	text = str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
	if not text:
		return ""
	paragraphs = re.split(r"\n\s*\n", text)
	html = []
	for para in paragraphs:
		lines = [escape(line.rstrip()) for line in para.split("\n")]
		html.append("<p>" + "<br>".join(lines) + "</p>")
	return "".join(html)


def sanitize_rich_html(html: Optional[str]) -> str:
	"""Remove tags/atributos perigosos e mantém a formatação permitida.

	- Texto puro (sem tags) é convertido em parágrafos HTML escapados.
	- Idempotente: sanitize(sanitize(x)) == sanitize(x).
	- Retorna "" quando não há conteúdo visível.
	"""
	if html is None:
		return ""
	text = str(html).strip()
	if not text:
		return ""
	if not HTML_HINT_RE.search(text):
		return plain_text_to_html(text)
	parser = _RichHTMLSanitizer()
	try:
		parser.feed(text)
		parser.close()
		result = parser.get_html().strip()
	except Exception:
		return plain_text_to_html(re.sub(r"<[^>]*>", "", unescape(text)))
	if not rich_text_has_content(result) and "<hr" not in result:
		return ""
	return result


def rich_text_has_content(html: Optional[str]) -> bool:
	"""Verifica se o HTML rico possui texto visível."""
	if not html:
		return False
	plain = re.sub(r"<[^>]+>", "", str(html))
	plain = unescape(plain).replace("\xa0", " ").strip()
	return bool(plain)


def rich_html_markup(html: Optional[str]) -> Markup:
	"""HTML seguro (já sanitizado) para uso direto em templates Jinja."""
	return Markup(sanitize_rich_html(html))


class _ReportLabConverter(HTMLParser):
	"""Converte HTML já sanitizado no mini-XML aceito por reportlab.Paragraph."""

	def __init__(self):
		super().__init__(convert_charrefs=True)
		self.out: list[str] = []
		self._closers: list[tuple[str, str]] = []
		self._lists: list[list] = []  # [tipo, contador]

	def _ends_with_break(self) -> bool:
		return not self.out or self.out[-1] == "<br/>"

	def _ensure_break(self):
		if not self._ends_with_break():
			self.out.append("<br/>")

	def handle_starttag(self, tag, attrs):
		attrs = dict(attrs)
		closer = ""
		if tag in ("b", "strong"):
			self.out.append("<b>"); closer = "</b>"
		elif tag in ("i", "em"):
			self.out.append("<i>"); closer = "</i>"
		elif tag == "u":
			self.out.append("<u>"); closer = "</u>"
		elif tag in ("s", "strike", "del"):
			self.out.append("<strike>"); closer = "</strike>"
		elif tag == "sub":
			self.out.append("<sub>"); closer = "</sub>"
		elif tag == "sup":
			self.out.append("<super>"); closer = "</super>"
		elif tag in ("code", "pre"):
			self.out.append('<font face="Courier">'); closer = "</font>"
		elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
			self._ensure_break()
			self.out.append("<b>"); closer = "</b>"
		elif tag in ("span", "mark", "font"):
			style = attrs.get("style") or ""
			color = attrs.get("color") or ""
			bg = ""
			for decl in style.split(";"):
				prop, _, val = decl.partition(":")
				prop, val = prop.strip().lower(), val.strip()
				if prop == "color":
					color = val
				elif prop == "background-color":
					bg = val
			color = color if color.startswith("#") else ""
			bg = bg if bg.startswith("#") else ""
			if tag == "mark" and not bg:
				bg = "#fef08a"
			if color or bg:
				fa = (f' color="{color}"' if color else "") + (f' backColor="{bg}"' if bg else "")
				self.out.append(f"<font{fa}>"); closer = "</font>"
		elif tag == "a":
			href = attrs.get("href") or ""
			if href:
				self.out.append(f'<a href="{escape(href, quote=True)}" color="#2563eb"><u>')
				closer = "</u></a>"
		elif tag in ("ul", "ol"):
			self._ensure_break()
			self._lists.append([tag, 0])
		elif tag == "li":
			self._ensure_break()
			depth = max(len(self._lists) - 1, 0)
			indent = "&nbsp;" * (4 * depth)
			if self._lists and self._lists[-1][0] == "ol":
				self._lists[-1][1] += 1
				marker = f"{self._lists[-1][1]}."
			else:
				marker = "•"
			self.out.append(f"{indent}{marker}&nbsp;")
		elif tag == "br":
			self.out.append("<br/>")
			return
		elif tag == "hr":
			self._ensure_break()
			return
		self._closers.append((tag, closer))

	def handle_endtag(self, tag):
		if tag in ("br", "hr"):
			return
		for idx in range(len(self._closers) - 1, -1, -1):
			if self._closers[idx][0] == tag:
				closer = self._closers[idx][1]
				del self._closers[idx:]
				break
		else:
			return
		if closer:
			self.out.append(closer)
		if tag in ("ul", "ol"):
			if self._lists:
				self._lists.pop()
			self._ensure_break()
		elif tag in ("p", "div", "blockquote", "li", "pre", "h1", "h2", "h3", "h4", "h5", "h6"):
			self._ensure_break()

	def handle_data(self, data):
		text = escape(data, quote=False).replace("\xa0", "&nbsp;")
		self.out.append(text.replace("\n", " "))


def html_to_reportlab(html: Optional[str]) -> str:
	"""Converte HTML sanitizado para markup compatível com ReportLab Paragraph.

	Suporta negrito/itálico/sublinhado/tachado, títulos (em negrito), listas, links,
	cor do texto e realce. Alinhamento de parágrafo não é aplicado dentro de um
	Paragraph único (limitação do PDF); a página pública e o editor o respeitam.
	"""
	if not html or not str(html).strip():
		return ""
	clean = sanitize_rich_html(html)
	if not clean:
		return ""
	conv = _ReportLabConverter()
	conv.feed(clean)
	conv.close()
	while conv._closers:
		_, closer = conv._closers.pop()
		conv.out.append(closer)
	while conv.out and conv.out[-1] == "<br/>":
		conv.out.pop()
	return "".join(conv.out).strip()
