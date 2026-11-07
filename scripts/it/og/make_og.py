#!/usr/bin/env python3
"""Render the share cards (og:image / twitter:image) of the Italian pages.

    python3 scripts/it/og/make_og.py                 it/og-image.jpg, it/<page>/og-image.jpg
    python3 scripts/it/og/make_og.py --lang en --out /some/dir   the English cards, for comparison

Each card is scripts/it/og/cards.html at 1200x630 in headless Chrome, saved as
a JPEG of about 130 KB (WhatsApp drops large preview images). The film cards
use the frames below, found by matching the English cards against the videos.
After a re-render, bump ?v= on og:image / twitter:image in scripts/it/*-raw.txt
so cached previews refetch, then rerun scripts/build_it.py.
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
HTML = Path(__file__).resolve().parent / 'cards.html'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

# card: (video, frame number at 25 fps), or None for the reports proof
STILLS = {
    'home':        ('media/intre-noi-loop-piero-1080.mp4', 209),
    'workshops':   ('exhibitions/media/intre-noi-film-1080.mp4', 445),
    'exhibitions': ('exhibitions/media/intre-noi-film-1080.mp4', 1342),
    'reports':     None,
}
DEST = {'home': 'og-image.jpg', 'workshops': 'workshops/og-image.jpg',
        'exhibitions': 'exhibitions/og-image.jpg', 'reports': 'reports/og-image.jpg'}


def still(video, frame, tmp):
    out = Path(tmp) / f'{Path(video).stem}-{frame}.png'
    if not out.exists():
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(ROOT / video),
                        '-vf', f'select=eq(n\\,{frame})', '-frames:v', '1', str(out)], check=True)
    return out


def render(card, lang, tmp):
    url = f'{HTML.as_uri()}?card={card}&lang={lang}'
    if STILLS[card]:
        url += '&still=' + still(*STILLS[card], tmp).as_uri()
    png = Path(tmp) / f'{card}-{lang}.png'
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                    '--force-device-scale-factor=1', '--window-size=1200,630',
                    '--allow-file-access-from-files', '--virtual-time-budget=15000',
                    f'--screenshot={png}', url],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return png


def save_jpeg(png, dest, target=135_000):
    im = Image.open(png).convert('RGB')
    assert im.size == (1200, 630), im.size
    dest.parent.mkdir(parents=True, exist_ok=True)
    for q in (88, 85, 82, 80, 78, 75, 72, 70):
        im.save(dest, 'JPEG', quality=q, optimize=True, progressive=True)
        if dest.stat().st_size <= target:
            break
    return q, dest.stat().st_size


def main():
    args = sys.argv[1:]
    lang = args[args.index('--lang') + 1] if '--lang' in args else 'it'
    out = Path(args[args.index('--out') + 1]) if '--out' in args else ROOT / 'it'
    only = [a for a in args if a in STILLS]
    with tempfile.TemporaryDirectory() as tmp:
        for card in only or STILLS:
            q, size = save_jpeg(render(card, lang, tmp), out / DEST[card])
            print(f'{card}: {out / DEST[card]}  q{q}  {size // 1000} KB')


if __name__ == '__main__':
    main()
