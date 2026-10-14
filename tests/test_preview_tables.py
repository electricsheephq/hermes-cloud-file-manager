"""The desktop's PREVIEW_EXTS (src/desktop/format.ts) and the gateway's preview tables must name the same files."""
import re

from conftest import PLUGIN_ROOT, load_plugin_api


def _desktop_tables():
    source = (PLUGIN_ROOT / "src" / "desktop" / "format.ts").read_text(encoding="utf-8")
    block = source[source.index("export const PREVIEW_EXTS"):]
    block = block[:block.index("\n}\n")]
    image = dict(re.findall(r"(\w+): '([\w/+.-]+)'", block[block.index("image:"):block.index("pdf:")]))
    pdf = set(re.findall(r"'(\w+)'", block[block.index("pdf:"):block.index("text:")]))
    text = set(" ".join(re.findall(r"'([\w ]+)'", block[block.index("text:"):])).split())
    return image, pdf, text


def test_desktop_and_gateway_preview_tables_match():
    api = load_plugin_api()
    image, pdf, text = _desktop_tables()
    assert image == api.PREVIEW_IMAGE_MIME
    assert pdf == api.PREVIEW_PDF_EXTS
    assert text == api.PREVIEW_TEXT_EXTS
    # Markdown and plain text stay with the editor, never the viewer.
    assert not {"md", "markdown", "txt"} & (set(image) | pdf | text)
