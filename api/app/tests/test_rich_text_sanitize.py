import unittest

from app.rich_text_utils import (
	html_to_reportlab,
	plain_text_to_html,
	rich_html_markup,
	rich_text_has_content,
	sanitize_rich_html,
)


class SanitizeRichHtmlTest(unittest.TestCase):
	# ----- segurança -----
	def test_removes_script_with_content(self):
		out = sanitize_rich_html("<p>Olá</p><script>alert(1)</script>")
		self.assertEqual(out, "<p>Olá</p>")
		self.assertNotIn("alert", out)

	def test_removes_style_iframe_object_embed(self):
		out = sanitize_rich_html(
			"<p>ok</p><style>body{display:none}</style>"
			"<iframe src='https://evil.test'>x</iframe><object data='a'></object><embed src='b'>"
		)
		self.assertEqual(out, "<p>ok</p>")

	def test_removes_event_handlers(self):
		out = sanitize_rich_html('<p onclick="alert(1)" onmouseover=alert(2)>Oi</p><b onload="x()">n</b>')
		self.assertNotIn("onclick", out)
		self.assertNotIn("onmouseover", out)
		self.assertNotIn("onload", out)
		self.assertNotIn("alert", out)
		self.assertEqual(out, "<p>Oi</p><b>n</b>")

	def test_removes_img_with_onerror(self):
		out = sanitize_rich_html('<p>a</p><img src=x onerror="alert(1)">')
		self.assertNotIn("<img", out)
		self.assertNotIn("onerror", out)

	def test_javascript_links_are_dropped_but_text_kept(self):
		for href in (
			"javascript:alert(1)",
			"JaVaScRiPt:alert(1)",
			"  javascript:alert(1)",
			"java\tscript:alert(1)",
			"java&#x09;script:alert(1)",
			"data:text/html;base64,PHNjcmlwdD4=",
			"vbscript:msgbox(1)",
			"//evil.test/x",
			"/relativo",
		):
			out = sanitize_rich_html(f'<p><a href="{href}">clique</a></p>')
			self.assertNotIn("href", out, href)
			self.assertNotIn("javascript", out.lower(), href)
			self.assertIn("clique", out)

	def test_allowed_link_schemes_get_safe_rel_and_target(self):
		for href in ("http://a.com/x?y=1&z=2", "https://a.com", "mailto:a@b.com", "tel:+5511999999999"):
			out = sanitize_rich_html(f'<p><a href="{href}" onclick="x()" target="_self" rel="opener">t</a></p>')
			self.assertIn('rel="noopener noreferrer"', out, href)
			self.assertIn('target="_blank"', out, href)
			self.assertNotIn("onclick", out)
			self.assertNotIn("opener\"", out.replace("noopener", ""))
			self.assertIn(">t</a>", out)

	def test_href_attribute_cannot_break_out(self):
		out = sanitize_rich_html('<a href="https://a.com/&quot; onmouseover=&quot;alert(1)">x</a>')
		self.assertNotIn('" onmouseover', out)
		self.assertEqual(out.count("<a "), 1)

	def test_style_only_allows_whitelisted_properties(self):
		out = sanitize_rich_html(
			'<p style="text-align: center; position: fixed; background: url(javascript:alert(1)); '
			'color: expression(alert(1))">x</p>'
		)
		self.assertEqual(out, '<p style="text-align: center">x</p>')

	def test_style_color_values_are_validated_and_normalized(self):
		out = sanitize_rich_html('<span style="color: rgb(255, 0, 0); background-color: #FDE047">x</span>')
		self.assertEqual(out, '<span style="color: #ff0000; background-color: #fde047">x</span>')
		out = sanitize_rich_html('<span style="color: red url(x)">x</span>')
		self.assertEqual(out, "<span>x</span>")

	def test_text_align_rejects_unknown_values_and_non_blocks(self):
		self.assertEqual(sanitize_rich_html('<p style="text-align: evil">x</p>'), "<p>x</p>")
		self.assertEqual(sanitize_rich_html('<span style="text-align: center">x</span>'), "<span>x</span>")

	def test_disallowed_tags_unwrapped_but_text_escaped(self):
		out = sanitize_rich_html("<p>a</p><marquee>texto</marquee><custom-tag>y</custom-tag>")
		self.assertEqual(out, "<p>a</p>textoy")

	def test_stray_closing_tags_do_not_close_unrelated_elements(self):
		out = sanitize_rich_html("<div><b>x</b></p></div>")
		self.assertEqual(out, "<div><b>x</b></div>")

	def test_unclosed_tags_are_closed(self):
		self.assertEqual(sanitize_rich_html("<p><b>negrito"), "<p><b>negrito</b></p>")

	def test_html_in_text_is_escaped_not_executed(self):
		out = sanitize_rich_html("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")
		self.assertNotIn("<script", out)
		self.assertIn("&lt;script&gt;", out)

	def test_comments_and_declarations_removed(self):
		out = sanitize_rich_html("<!-- segredo --><p>a</p><!DOCTYPE html>")
		self.assertEqual(out, "<p>a</p>")

	def test_idempotent(self):
		raw = (
			'<h2 style="text-align:center">T</h2><p><strong>b</strong> <a href="https://x.com">l</a>'
			'<script>x</script></p><ul><li><p>i</p></li></ul>'
		)
		once = sanitize_rich_html(raw)
		self.assertEqual(sanitize_rich_html(once), once)

	# ----- formatação preservada -----
	def test_preserves_editor_formatting(self):
		html = (
			'<h1>Título</h1><h2>Sub</h2>'
			'<p style="text-align: right"><strong>n</strong><em>i</em><u>u</u><s>s</s></p>'
			'<p><span style="color: #dc2626">cor</span><mark style="background-color: #fde047; color: inherit">hl</mark></p>'
			'<ul><li><p>a</p></li><li><p>b</p></li></ul><ol><li><p>1</p></li></ol>'
			'<blockquote><p>q</p></blockquote><hr><p>x<br>y</p>'
			'<p><a href="https://a.com" target="_blank" rel="noopener noreferrer">l</a></p>'
		)
		self.assertEqual(sanitize_rich_html(html), html)

	def test_preserves_legacy_editor_markup(self):
		html = '<div><b>x</b> <font color="#2563eb">azul</font></div><ul><li>a</li></ul>'
		self.assertEqual(sanitize_rich_html(html), html)

	def test_font_color_validated(self):
		self.assertEqual(sanitize_rich_html('<font color="javascript:x">a</font>'), "<font>a</font>")

	# ----- texto puro legado -----
	def test_plain_text_is_escaped_and_keeps_line_breaks(self):
		out = sanitize_rich_html("Linha 1\nLinha 2\n\nOutro parágrafo & <3 \"aspas\"")
		self.assertEqual(
			out,
			"<p>Linha 1<br>Linha 2</p><p>Outro parágrafo &amp; &lt;3 &quot;aspas&quot;</p>",
		)

	def test_plain_text_crlf(self):
		self.assertEqual(sanitize_rich_html("a\r\nb"), "<p>a<br>b</p>")

	def test_plain_text_with_angle_brackets_without_tags(self):
		self.assertEqual(sanitize_rich_html("5 < 7 e 9 > 3"), "<p>5 &lt; 7 e 9 &gt; 3</p>")

	def test_plain_text_to_html_helper(self):
		self.assertEqual(plain_text_to_html("<b>x</b>"), "<p>&lt;b&gt;x&lt;/b&gt;</p>")

	# ----- vazio -----
	def test_empty_values(self):
		for v in (None, "", "   ", "<p></p>", "<p><br></p>", "<div> </div>", "<script>x</script>"):
			self.assertEqual(sanitize_rich_html(v), "", repr(v))

	def test_rich_text_has_content(self):
		self.assertFalse(rich_text_has_content("<p></p>"))
		self.assertFalse(rich_text_has_content("<p>&nbsp;</p>"))
		self.assertTrue(rich_text_has_content("<p>a</p>"))

	def test_rich_html_markup_is_sanitized(self):
		markup = rich_html_markup('<p onclick="x()">a</p><script>b</script>')
		self.assertEqual(str(markup), "<p>a</p>")
		self.assertEqual(str(rich_html_markup("a\nb")), "<p>a<br>b</p>")


class HtmlToReportlabTest(unittest.TestCase):
	def test_basic_formatting(self):
		out = html_to_reportlab("<p><strong>n</strong> <em>i</em> <u>u</u> <s>t</s></p>")
		self.assertEqual(out, "<b>n</b> <i>i</i> <u>u</u> <strike>t</strike>")

	def test_lists_and_headings(self):
		out = html_to_reportlab("<h2>Título</h2><ul><li><p>a</p></li><li><p>b</p></li></ul><ol><li>x</li></ol>")
		self.assertIn("<b>Título</b>", out)
		self.assertIn("•&nbsp;a<br/>", out)
		self.assertIn("•&nbsp;b<br/>", out)
		self.assertIn("1.&nbsp;x", out)
		self.assertNotIn("<br/><br/>", out)

	def test_colors_and_link(self):
		out = html_to_reportlab(
			'<p><span style="color: #dc2626">r</span><mark style="background-color: #fde047">h</mark>'
			'<a href="https://a.com/?a=1&b=2">l</a></p>'
		)
		self.assertIn('<font color="#dc2626">r</font>', out)
		self.assertIn('<font backColor="#fde047">h</font>', out)
		self.assertIn('<a href="https://a.com/?a=1&amp;b=2"', out)

	def test_plain_text_legacy_and_escaping(self):
		self.assertEqual(html_to_reportlab("a & b\nc"), "a &amp; b<br/>c")

	def test_malicious_input_is_neutralised(self):
		out = html_to_reportlab('<script>x</script><p onclick="y">a <b>b</b></p>')
		self.assertEqual(out, "a <b>b</b>")

	def test_output_is_valid_for_reportlab_paragraph(self):
		try:
			from reportlab.lib.styles import getSampleStyleSheet
			from reportlab.platypus import Paragraph
		except ImportError:  # pragma: no cover
			self.skipTest("reportlab indisponível")
		html = (
			'<h1>T</h1><p style="text-align:center"><strong>a</strong> <em>b</em> <u>c</u> <s>d</s> '
			'<span style="color:#dc2626">e</span><mark style="background-color:#fde047">f</mark> '
			'<a href="https://a.com/?a=1&b=2">g</a> x &amp; y</p><ul><li><p>i</p></li></ul>'
			'<ol><li>1<ul><li>sub</li></ul></li></ol><sub>s</sub><sup>p</sup><code>c</code>'
		)
		Paragraph(html_to_reportlab(html), getSampleStyleSheet()["Normal"])


if __name__ == "__main__":
	unittest.main()
