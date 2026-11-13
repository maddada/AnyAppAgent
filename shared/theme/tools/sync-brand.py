"""Derive platform SVGs from the approved Bright Eye masters in assets/brand."""
from pathlib import Path
import re
import shutil

THEME = Path(__file__).resolve().parents[1]
SOURCE = THEME.parents[1] / 'assets' / 'brand'
MARK = THEME / 'mark'
PAPER = '#FFF5DB'

def contents(name):
    value = (SOURCE / name).read_text(encoding='utf-8')
    return re.sub(r'^.*?</title>', '', value, flags=re.S).removesuffix('</svg>')

def svg(body, view='0 0 128 128'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}"><title>Kiwimake</title>{body}</svg>\n'

def write(name, value):
    target = MARK / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value, encoding='utf-8')

for source, target in [
    ('kiwimake-icon.svg', 'mark.svg'),
    ('kiwimake-icon-small.svg', 'mark-small.svg'),
    ('kiwimake-wordmark.svg', 'lockup.svg'),
    ('kiwimake-wordmark-dark.svg', 'lockup-dark.svg'),
]:
    shutil.copyfile(SOURCE / source, MARK / target)

lettering = (SOURCE / 'kiwimake-lettering.svg').read_text(encoding='utf-8')
for name, color in [('wordmark.svg', '#193E2D'), ('wordmark-dark.svg', '#FFF5DB'), ('wordmark-mono.svg', 'currentColor')]:
    write(name, lettering.replace('fill="currentColor"', f'fill="{color}"'))

bird = contents('kiwimake-icon.svg')
mono = contents('kiwimake-monochrome.svg').replace('currentColor', '#FFFFFF')
# Legacy launchers use the same cream plate and 75% mark as the approved mocks.
write('android/launcher.svg', svg(f'<rect width="128" height="128" rx="32" fill="{PAPER}"/><g transform="translate(16 16) scale(.75)">{bird}</g>'))
write('android/adaptive-background.svg', svg(f'<rect width="108" height="108" fill="{PAPER}"/>', '0 0 108 108'))
# Android clips the central 72 of its 108 units. The 54-unit foreground becomes
# 75% of that mask, matching the approved round and squircle studies.
for name, body in [('adaptive-foreground.svg', bird), ('adaptive-monochrome.svg', mono)]:
    write('android/' + name, svg(f'<g transform="translate(27 27) scale(.421875)">{body}</g>', '0 0 108 108'))
write('android/ic-stat.svg', svg(mono))
print('Synced approved masters, wordmarks and Android SVG layers to', MARK)
