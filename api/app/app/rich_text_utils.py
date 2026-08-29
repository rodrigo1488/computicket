"""Sanitização e conversão de HTML rico para exibição e PDF."""
import re
from html import escape, unescape
from html.parser import HTMLParser
from io import StringIO
from typing import Optional

from markupsafe import Markup

ALLOWED_TAGS = frozenset({
	"b", "strong", "i", "em", "u", "span", "font", "ul", "ol", "li", "br", "p", "div",
})
VOID_TAGS = frozenset({"br"})
COLOR_RE = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


class _RichHTMLSanitizer(HTMLParser):
	def __init__(self):
		super().__init__(convert_charrefs=True)
		self._out = StringIO()
		self._tag_stack: list[str] = []

	def handle_starttag(self, tag, attrs):
		tag = tag.lower()
		if tag not in ALLOWED_TAGS:
			return
		if tag in VOID_TAGS:
			self._out.write(f"<{tag}/>")
			return
		clean_attrs = self._clean_attrs(tag, attrs)
		attr_str = "".join(f' {k}="{escape(v, quote=True)}"' for k, v in clean_attrs)
		self._out.write(f"<{tag}{attr_str}>")
		self._tag_stack.append(tag)

	def handle_endtag(self, tag):
		tag = tag.lower()
		if tag not in ALLOWED_TAGS or tag in VOID_TAGS:
			return
		while self._tag_stack:
			open_tag = self._tag_stack.pop()
			self._out.write(f"</{open_tag}>")
			if open_tag == tag:
				break

	def handle_data(self, data):
		self._out.write(escape(data))

	def handle_entityref(self, name):
		self._out.write(f"&{name};")

	def handle_charref(self, name):
		self._out.write(f"&#{name};")

	def get_html(self) -> str:
		while self._tag_stack:
			self._out.write(f"</{self._tag_stack.pop()}>")
		return self._out.getvalue()

	def _clean_attrs(self, tag, attrs):
		clean = []
		for key, value in attrs:
			key = key.lower()
			if key == "style" and tag == "span":
				color = self._extract_color(value or "")
				if color:
					clean.append(("style", f"color: {color}"))
			elif key == "color" and tag == "font":
				color = self._normalize_color(value or "")
				if color:
					clean.append(("color", color))
		return clean

	def _extract_color(self, style: str) -> Optional[str]:
		match = re.search(r"color\s*:\s*(#[0-9a-fA-F]{3,6})", style, re.I)
		if not match:
			return None
		return self._normalize_color(match.group(1))

	def _normalize_color(self, value: str) -> Optional[str]:
		value = (value or "").strip()
		if COLOR_RE.match(value):
			return value.lower()
		return None


def sanitize_rich_html(html: Optional[str]) -> str:
	"""Remove tags/atributos perigosos e mantém formatação básica."""
	if not html or not str(html).strip():
		return ""
	text = str(html).strip()
	text = re.sub(
		r'color\s*:\s*rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)',
		lambda m: 'color: #{:02x}{:02x}{:02x}'.format(
			min(255, int(m.group(1))), min(255, int(m.group(2))), min(255, int(m.group(3)))
		),
		text,
		flags=re.I,
	)
	text = re.sub(r"(?is)<(script|style|iframe|object|embed)[^>]*>.*?</\1>", "", text)
	text = re.sub(r"(?i)\s(on\w+|javascript:)[^=]*=\s*['\"][^'\"]*['\"]", "", text)
	parser = _RichHTMLSanitizer()
	try:
		parser.feed(text)
		parser.close()
		result = parser.get_html().strip()
	except Exception:
		result = escape(unescape(text))
	return result


def rich_text_has_content(html: Optional[str]) -> bool:
	"""Verifica se o HTML rico possui texto visível."""
	if not html:
		return False
	plain = re.sub(r"<[^>]+>", "", str(html))
	plain = unescape(plain).replace("\xa0", " ").strip()
	return bool(plain)


def rich_html_markup(html: Optional[str]) -> Markup:
	return Markup(sanitize_rich_html(html))


def html_to_reportlab(html: Optional[str]) -> str:
	"""Converte HTML sanitizado para markup compatível com ReportLab Paragraph."""
	if not html or not str(html).strip():
		return ""
	text = sanitize_rich_html(html)
	if not text:
		return ""
	text = re.sub(r"(?i)<strong>", "<b>", text)
	text = re.sub(r"(?i)</strong>", "</b>", text)
	text = re.sub(r"(?i)<em>", "<i>", text)
	text = re.sub(r"(?i)</em>", "</i>", text)
	text = re.sub(
		r'<span[^>]*style="color:\s*(#[0-9a-fA-F]{3,6})"[^>]*>(.*?)</span>',
		r'<font color="\1">\2</font>',
		text,
		flags=re.I | re.S,
	)
	text = re.sub(r"(?i)</p>\s*<p>", "<br/>", text)
	text = re.sub(r"(?i)</div>\s*<div>", "<br/>", text)
	text = re.sub(r"(?i)<p>", "", text)
	text = re.sub(r"(?i)</p>", "<br/>", text)
	text = re.sub(r"(?i)<div>", "", text)
	text = re.sub(r"(?i)</div>", "<br/>", text)

	def _li_to_bullet(match):
		content = match.group(1).strip()
		return f"• {content}<br/>"

	text = re.sub(r"(?is)<li[^>]*>(.*?)</li>", _li_to_bullet, text)
	text = re.sub(r"(?is)</?(ul|ol)[^>]*>", "", text)
	text = re.sub(r"(?i)<br\s*/?>\s*<br\s*/?>", "<br/>", text)
	return text.strip()
