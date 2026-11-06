#!/usr/bin/env python3
"""
One-off: turns the wordmark and the start cards' ghost words into outlines, so the app needs no font for them.
The SVGs it writes are committed to src/assets/brand/. The fonts and fontTools are for this script alone: they are not in the
repository, in package.json or in the app.

Font: IBM Plex Sans Condensed, Bold and Medium, from the official release: the npm package @ibm/plex-sans-condensed, version 2.0.0
(fonts/complete/woff; https://github.com/IBM/plex). SIL Open Font License 1.1.
Tool: fontTools (pip install fonttools).

From the root of the project, with the package unpacked anywhere:

    npm pack @ibm/plex-sans-condensed@2.0.0
    tar xzf ibm-plex-sans-condensed-2.0.0.tgz
    python scripts/gen-wordmark.py package

Without the fonts it stops: no other font will do.
"""
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

# As the design has them, in thousandths of an em
WORDMARK_TRACKING = -5
GHOST_TRACKING = -20
# The ghost words' line, as a share of the em: their box is that line, so they sit as text of that line height would
GHOST_LINE = 800

OUT = Path('src/assets/brand')


def fmt(v):
    return f'{v:.1f}'.rstrip('0').rstrip('.')


def kerning(font):
    """The font's pair kerning, from its `kern` lookups in GPOS: the amount by which the first glyph's advance changes."""
    gpos = font['GPOS'].table
    lookups = sorted({i for r in gpos.FeatureList.FeatureRecord if r.FeatureTag == 'kern' for i in r.Feature.LookupListIndex})

    def in_lookup(lookup, left, right):
        for sub in lookup.SubTable:
            if sub.LookupType == 9:
                sub = sub.ExtSubTable
            if sub.LookupType != 2 or left not in sub.Coverage.glyphs:
                continue
            if sub.Format == 1:
                for rec in sub.PairSet[sub.Coverage.glyphs.index(left)].PairValueRecord:
                    if rec.SecondGlyph == right:
                        return getattr(rec.Value1, 'XAdvance', 0) if rec.Value1 else 0
            else:
                c1 = sub.ClassDef1.classDefs.get(left, 0)
                c2 = sub.ClassDef2.classDefs.get(right, 0)
                value = sub.Class1Record[c1].Class2Record[c2].Value1
                return getattr(value, 'XAdvance', 0) if value else 0
        return 0

    return lambda left, right: sum(in_lookup(gpos.LookupList.Lookup[i], left, right) for i in lookups)


class Face:
    def __init__(self, path):
        self.font = TTFont(path)
        self.glyphs = self.font.getGlyphSet()
        self.cmap = self.font.getBestCmap()
        self.kern = kerning(self.font)
        assert self.font['head'].unitsPerEm == 1000

    def layout(self, text, tracking, x=0):
        """Each glyph and where it starts; and where the text ends. The tracking follows every glyph, as CSS letter-spacing does."""
        names = [self.cmap[ord(c)] for c in text]
        placed = []
        for i, name in enumerate(names):
            placed.append((name, x))
            x += self.glyphs[name].width + tracking
            if i + 1 < len(names):
                x += self.kern(name, names[i + 1])
        return placed, x

    def bounds(self, placed):
        pen = BoundsPen(self.glyphs)
        for name, x in placed:
            self.glyphs[name].draw(TransformPen(pen, (1, 0, 0, 1, x, 0)))
        return pen.bounds

    def path(self, placed, dx, baseline):
        """y goes down in SVG."""
        pen = SVGPathPen(self.glyphs, ntos=fmt)
        for name, x in placed:
            self.glyphs[name].draw(TransformPen(pen, (1, 0, 0, -1, x + dx, baseline)))
        return pen.getCommands()


def write(name, width, height, paths):
    body = ''.join(f'<path fill="currentColor" d="{d}"/>' for d in paths)
    (OUT / name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 {fmt(width)} {fmt(height)}">{body}</svg>\n', encoding='utf8', newline='\n')


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    fonts = Path(sys.argv[1]) / 'fonts' / 'complete' / 'woff'
    paths = [fonts / f'IBMPlexSansCondensed-{w}.woff' for w in ('Bold', 'Medium')]
    missing = [str(p) for p in paths if not p.is_file()]
    if missing:
        sys.exit(f'IBM Plex Sans Condensed not found: {", ".join(missing)}')
    bold, medium = (Face(p) for p in paths)
    print('font version:', bold.font['name'].getDebugName(5))
    OUT.mkdir(parents=True, exist_ok=True)

    # the wordmark: a box tight round its ink
    lithic, end = bold.layout('Lithic', WORDMARK_TRACKING)
    analyst, advance = medium.layout('Analyst', WORDMARK_TRACKING, end)
    a, b = bold.bounds(lithic), medium.bounds(analyst)
    x0, y0, x1, y1 = min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])
    write('wordmark.svg', x1 - x0, y1 - y0, [bold.path(lithic, -x0, y1), medium.path(analyst, -x0, y1)])
    print(f'wordmark: viewBox {fmt(x1 - x0)} x {fmt(y1 - y0)}, advance {fmt(advance)}, ink starts at {fmt(x0)}, rises {fmt(y1)} over the baseline and falls {fmt(-y0)} under it')

    # the ghost words: the box of a line of text, so the card lays them out as it would that line
    ascent, descent = bold.font['hhea'].ascent, bold.font['hhea'].descent
    baseline = (GHOST_LINE - (ascent - descent)) / 2 + ascent
    print(f'hhea {ascent} {descent}; ghost baseline at {fmt(baseline)} in a line of {GHOST_LINE}')
    for word in ('CORE', 'FLAKE', 'GENERAL'):
        placed, width = bold.layout(word, GHOST_TRACKING)
        write(f'ghost-{word.lower()}.svg', width, GHOST_LINE, [bold.path(placed, 0, baseline)])
        print(f'{word}: advance {fmt(width)}')


if __name__ == '__main__':
    main()
