# Outlines the wordmark "Kiwimake" from Bricolage Grotesque Display ExtraBold into SVG paths,
# so the wordmark needs no font. Run once after changing the font or the tracking:
#   python tools/make-wordmark.py        (needs fontTools: pip install fonttools)
import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, "fonts", "BricolageGrotesque-Display-ExtraBold.ttf")
TEXT = "Kiwimake"
TRACKING = -0.025  # em, same as tokens.look.wordmarkLetterSpacing
SIZE = 100  # font size in SVG units

font = TTFont(FONT)
glyph_set = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font["head"].unitsPerEm
hhea = font["hhea"]
scale = SIZE / upm
ascent = hhea.ascent * scale
cap = font["OS/2"].sCapHeight * scale
descent = -font["OS/2"].sTypoDescender * scale

pen = SVGPathPen(glyph_set)
x = 0.0
kern = None
for i, ch in enumerate(TEXT):
    name = cmap[ord(ch)]
    tp = TransformPen(pen, (scale, 0, 0, -scale, x, ascent))
    glyph_set[name].draw(tp)
    x += glyph_set[name].width * scale + TRACKING * SIZE
width = x - TRACKING * SIZE
path = pen.getCommands()

# Crop to ink: top of the caps to the baseline plus descender of "y" and "p".
top = ascent - cap - 2
height = cap + descent * 0.95 + 4
view = f"0 {top:.1f} {width:.1f} {height:.1f}"


def svg(fill, title="Kiwimake"):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" width="{width:.0f}" height="{height:.0f}">'
        f"<title>{title}</title><path fill=\"{fill}\" d=\"{path}\"/></svg>\n"
    )


out = os.path.join(ROOT, "mark")
open(os.path.join(out, "wordmark.svg"), "w").write(svg("#1F1B16"))
open(os.path.join(out, "wordmark-dark.svg"), "w").write(svg("#EEE8DD"))
open(os.path.join(out, "wordmark-mono.svg"), "w").write(svg("currentColor"))

# Lockup: mark at cap height x 1.55, gap 0.3 of the mark, wordmark baseline-centred on the mark.
mark_size = cap * 1.55
gap = mark_size * 0.32
total_w = mark_size + gap + width
mark_y = top + (cap - mark_size) / 2 + 2


def lockup(fill, mark_bg, mark_fg):
    s = mark_size / 108
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {top:.1f} {total_w:.1f} {height:.1f}" width="{total_w:.0f}" height="{height:.0f}">'
        f"<title>Kiwimake</title>"
        f'<g transform="translate(0 {mark_y:.2f}) scale({s:.4f})">'
        f'<rect width="108" height="108" rx="26" fill="{mark_bg}"/>'
        f'<g fill="{mark_fg}"><rect x="27" y="27" width="24" height="24" rx="6"/><rect x="57" y="27" width="24" height="24" rx="6"/><rect x="27" y="57" width="24" height="24" rx="6"/></g>'
        f'<rect x="59.5" y="59.5" width="19" height="19" rx="4.5" fill="none" stroke="{mark_fg}" stroke-width="5" transform="rotate(-14 69 69)"/>'
        f"</g>"
        f'<g transform="translate({mark_size + gap:.2f} 0)"><path fill="{fill}" d="{path}"/></g></svg>\n'
    )


open(os.path.join(out, "lockup.svg"), "w").write(lockup("#1F1B16", "#1D6A4A", "#F7F4EC"))
open(os.path.join(out, "lockup-dark.svg"), "w").write(lockup("#EEE8DD", "#6DBB8F", "#0E2117"))
print("wordmark", round(width), "x", round(height))
