"""Transcrição fiel de arquivos PDF para Markdown preservando texto e imagens."""
from __future__ import annotations

import os
import re
import statistics
import uuid
from pathlib import Path
from typing import Any

MEDIA_URL_PREFIX = "/flask/api/web/knowledge/media"

_BULLET_RE = re.compile(r"^\s*[•●▪◦▫‣⁃–—\-\*]\s+(.*)$")
_ORDERED_RE = re.compile(r"^\s*(\d{1,3})[.)]\s+(.*)$")
_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")


def _rect_intersects(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
	ax0, ay0, ax1, ay1 = a
	bx0, by0, bx1, by1 = b
	if ax1 <= bx0 or bx1 <= ax0 or ay1 <= by0 or by1 <= ay0:
		return False
	inter_w = min(ax1, bx1) - max(ax0, bx0)
	inter_h = min(ay1, by1) - max(ay0, by0)
	area_a = max(1.0, (ax1 - ax0) * (ay1 - ay0))
	return (inter_w * inter_h) / area_a > 0.35


def _detect_body_font_size(doc: Any) -> float:
	sizes: list[float] = []
	for page in doc:
		info = page.get_text("dict")
		for block in info.get("blocks", []):
			if block.get("type") != 0:
				continue
			for line in block.get("lines", []):
				for span in line.get("spans", []):
					text = (span.get("text") or "").strip()
					if len(text) >= 3:
						sizes.append(float(span.get("size") or 11.0))
	if not sizes:
		return 11.0
	return float(statistics.median(sizes))


def _format_span(span: dict[str, Any]) -> str:
	raw = span.get("text") or ""
	if not raw.strip():
		return raw
	lead = raw[: len(raw) - len(raw.lstrip())]
	trail = raw[len(raw.rstrip()) :]
	core = raw.strip()

	flags = int(span.get("flags") or 0)
	font = (span.get("font") or "").lower()
	is_mono = bool(flags & 8) or any(k in font for k in ("mono", "courier", "consola", "code"))
	is_bold = bool(flags & 16) or any(k in font for k in ("bold", "black", "heavy", "semibold", "demi"))
	is_italic = bool(flags & 2) or any(k in font for k in ("italic", "oblique"))

	if is_mono and "`" not in core:
		core = f"`{core}`"
	elif is_bold and is_italic:
		core = f"***{core}***"
	elif is_bold:
		core = f"**{core}**"
	elif is_italic:
		core = f"*{core}*"
	return f"{lead}{core}{trail}"


def _block_to_markdown(block: dict[str, Any], body_size: float) -> tuple[str, bool]:
	lines_out: list[str] = []
	max_size = 0.0
	all_bold = True
	plain_chars = 0

	for line in block.get("lines", []):
		spans = line.get("spans", [])
		if not spans:
			continue
		line_parts: list[str] = []
		plain_parts: list[str] = []
		for span in spans:
			txt = span.get("text") or ""
			if txt.strip():
				plain_chars += len(txt.strip())
				max_size = max(max_size, float(span.get("size") or body_size))
				flags = int(span.get("flags") or 0)
				font = (span.get("font") or "").lower()
				if not (bool(flags & 16) or any(k in font for k in ("bold", "black", "heavy", "semibold", "demi"))):
					all_bold = False
			plain_parts.append(txt)
			line_parts.append(_format_span(span))

		plain_line = "".join(plain_parts).strip()
		if not plain_line:
			continue

		bullet = _BULLET_RE.match(plain_line)
		ordered = _ORDERED_RE.match(plain_line)
		if bullet:
			formatted = "".join(line_parts).strip()
			cleaned = _BULLET_RE.sub(r"- \1", formatted)
			lines_out.append(cleaned)
		elif ordered:
			formatted = "".join(line_parts).strip()
			cleaned = _ORDERED_RE.sub(r"\1. \2", formatted)
			lines_out.append(cleaned)
		else:
			lines_out.append("".join(line_parts).strip())

	if not lines_out:
		return "", False

	joined = "\n".join(lines_out).strip()
	plain_joined = re.sub(r"[*_`]", "", joined).strip()

	# Detecta títulos por tamanho relativo da fonte em blocos curtos
	is_short_heading = len(lines_out) <= 2 and plain_chars <= 140
	if is_short_heading and not plain_joined.startswith(("- ", "* ")):
		if max_size >= body_size * 1.45:
			return f"# {plain_joined}", True
		if max_size >= body_size * 1.25:
			return f"## {plain_joined}", True
		if max_size >= body_size * 1.12 and all_bold:
			return f"### {plain_joined}", True

	return joined, False


def _save_pixmap_png(pixmap: Any, upload_folder: str, prefix: str = "kb_pdf") -> str:
	name = f"{prefix}_{uuid.uuid4().hex}.png"
	dest = os.path.join(upload_folder, name)
	pixmap.save(dest)
	return name


def _save_extracted_image(doc: Any, page: Any, bbox: tuple[float, float, float, float], xref: int | None, upload_folder: str) -> str | None:
	import fitz

	rect = fitz.Rect(bbox) & page.rect
	if rect.is_empty or rect.width < 12 or rect.height < 12:
		return None

	# Renderizar o recorte da página em alta definição garante fidelidade visual idêntica ao PDF
	# (preserva rotação, máscaras, transparência e sobreposições).
	try:
		pix = page.get_pixmap(clip=rect, dpi=150, alpha=False)
		if pix.width >= 12 and pix.height >= 12:
			return _save_pixmap_png(pix, upload_folder)
	except Exception:
		pass

	if xref:
		try:
			extracted = doc.extract_image(xref)
			raw = extracted.get("image")
			ext = (extracted.get("ext") or "png").lower()
			if ext not in {"png", "jpg", "jpeg", "webp", "gif"}:
				ext = "png"
			if raw:
				name = f"kb_pdf_{uuid.uuid4().hex}.{ext}"
				with open(os.path.join(upload_folder, name), "wb") as fp:
					fp.write(raw)
				return name
		except Exception:
			pass
	return None


def transcribe_pdf_to_markdown(
	pdf_bytes: bytes,
	upload_folder: str,
	filename_hint: str = "",
) -> dict[str, Any]:
	"""Converte um PDF em Markdown preservando textos, tabelas e imagens na ordem original."""
	try:
		import fitz
	except ImportError as exc:
		raise RuntimeError("PyMuPDF não está instalado no servidor para transcrever PDFs.") from exc

	if not pdf_bytes:
		raise ValueError("Arquivo PDF vazio.")

	os.makedirs(upload_folder, exist_ok=True)
	doc = fitz.open(stream=pdf_bytes, filetype="pdf")
	if doc.page_count == 0:
		raise ValueError("O PDF não possui páginas.")

	try:
		body_size = _detect_body_font_size(doc)
		pages_markdown: list[str] = []
		total_images = 0
		first_heading = ""
		plain_preview_parts: list[str] = []

		for page_idx in range(doc.page_count):
			page = doc.load_page(page_idx)
			page_num = page_idx + 1
			elements: list[tuple[float, float, str]] = []
			table_rects: list[tuple[float, float, float, float]] = []

			# 1. Tabelas
			if hasattr(page, "find_tables"):
				try:
					tabs = page.find_tables()
					for tab in getattr(tabs, "tables", []) or []:
						md_tab = (tab.to_markdown() or "").strip()
						if md_tab:
							bbox = tuple(tab.bbox)
							table_rects.append(bbox)
							elements.append((bbox[1], bbox[0], md_tab))
				except Exception:
					pass

			# 2. Blocos de texto e imagens posicionadas
			page_dict = page.get_text(
				"dict",
				flags=fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_PRESERVE_IMAGES,
			)
			seen_img_boxes: list[tuple[float, float, float, float]] = []
			text_count_on_page = 0

			for block in page_dict.get("blocks", []):
				btype = block.get("type")
				bbox = tuple(float(v) for v in block.get("bbox", (0, 0, 0, 0)))

				if btype == 1:
					saved = _save_extracted_image(doc, page, bbox, block.get("xref"), upload_folder)
					if saved:
						total_images += 1
						seen_img_boxes.append(bbox)
						elements.append(
							(bbox[1], bbox[0], f"![Página {page_num} - Figura {total_images}]({MEDIA_URL_PREFIX}/{saved})")
						)
					continue

				if btype != 0:
					continue

				if any(_rect_intersects(bbox, tr) for tr in table_rects):
					continue

				md_block, is_heading = _block_to_markdown(block, body_size)
				if not md_block:
					continue
				text_count_on_page += len(md_block)
				if is_heading and not first_heading:
					first_heading = re.sub(r"^#+\s*", "", md_block).strip()
				elif not is_heading and len(" ".join(plain_preview_parts)) < 240:
					plain_preview_parts.append(re.sub(r"[*_`#>\-\[\]()!]", "", md_block))
				elements.append((bbox[1], bbox[0], md_block))

			# 3. Garante imagens referenciadas fora de blocos padrão (ex.: XObjects)
			try:
				for img_info in page.get_image_info(xrefs=True) or []:
					ibbox = tuple(float(v) for v in img_info.get("bbox", (0, 0, 0, 0)))
					if any(_rect_intersects(ibbox, sb) for sb in seen_img_boxes):
						continue
					saved = _save_extracted_image(doc, page, ibbox, img_info.get("xref"), upload_folder)
					if saved:
						total_images += 1
						seen_img_boxes.append(ibbox)
						elements.append(
							(ibbox[1], ibbox[0], f"![Página {page_num} - Figura {total_images}]({MEDIA_URL_PREFIX}/{saved})")
						)
			except Exception:
				pass

			# 4. Fallback para página escaneada (imagem única sem texto extraível)
			if text_count_on_page < 20 and not seen_img_boxes and not table_rects:
				try:
					full_pix = page.get_pixmap(dpi=150, alpha=False)
					saved = _save_pixmap_png(full_pix, upload_folder, prefix="kb_pdf_page")
					total_images += 1
					elements.append((0.0, 0.0, f"![Página {page_num}]({MEDIA_URL_PREFIX}/{saved})"))
				except Exception:
					pass

			elements.sort(key=lambda item: (round(item[0], 1), round(item[1], 1)))
			page_md = "\n\n".join(item[2] for item in elements if item[2].strip())
			if page_md:
				pages_markdown.append(page_md)

		full_markdown = "\n\n---\n\n".join(pages_markdown).strip()
		full_markdown = _MULTI_NEWLINE_RE.sub("\n\n", full_markdown)

		stem = Path(filename_hint).stem.replace("_", " ").replace("-", " ").strip() if filename_hint else ""
		suggested_title = (first_heading or stem or "Artigo importado de PDF")[:200]
		raw_summary = re.sub(r"\s+", " ", " ".join(plain_preview_parts)).strip()
		suggested_summary = raw_summary[:100].strip()

		return {
			"markdown": full_markdown,
			"suggested_title": suggested_title,
			"suggested_summary": suggested_summary,
			"pages_count": doc.page_count,
			"images_count": total_images,
		}
	finally:
		doc.close()
