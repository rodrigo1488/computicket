"""Gera assets/uniplus_agent.ico (16/32/48/256) para o EXE e a bandeja."""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw


def _make_base(size: int) -> Image.Image:
	img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
	draw = ImageDraw.Draw(img)
	pad = max(1, size // 16)
	draw.ellipse(
		[pad, pad, size - pad - 1, size - pad - 1],
		fill=(14, 116, 144),
		outline=(8, 80, 100),
	)
	m = size // 4
	draw.rectangle([m, m, size - m, size - m - size // 8], fill=(255, 255, 255))
	draw.polygon(
		[
			(m + size // 16, size - m - size // 8),
			(size - m - size // 16, size - m - size // 8),
			(size // 2, size - m + size // 16),
		],
		fill=(255, 255, 255),
	)
	return img


def main() -> int:
	here = os.path.dirname(os.path.abspath(__file__))
	out_dir = os.path.join(here, "assets")
	os.makedirs(out_dir, exist_ok=True)
	out = os.path.join(out_dir, "uniplus_agent.ico")
	img = _make_base(256)
	img.save(out, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
	print(f"OK: {out}")
	return 0


if __name__ == "__main__":
	sys.exit(main())
