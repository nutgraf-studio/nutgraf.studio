#!/usr/bin/env python3
"""Build the Italian edition of the site (nutgraf.studio/it/) from the English pages.

    python3 scripts/build_it.py            build it/ and report anything still in English
    python3 scripts/build_it.py --js       also list the JavaScript strings left as they were
    python3 scripts/build_it.py --src DIR  read the English pages from DIR instead (e.g. the
                                           committed versions, when other sessions have
                                           unpublished edits in the working tree)

The English pages stay the source. Each run copies index.html, workshops/,
exhibitions/ and reports/ into it/, then:

  1. applies the RAW pairs in scripts/it/<page>-raw.txt and common-raw.txt
     (markup that spans tags, JavaScript strings, structured-data URLs);
  2. translates every text node, every alt / aria-label / title / caption
     attribute and every string in the JSON-LD blocks that matches an entry
     in the TEXT files (scripts/it/*.txt);
  3. points relative asset paths at the English folders (/reports/img/...)
     and internal page links at the Italian pages (/reports/ -> /it/reports/);
  4. sets lang, canonical, og:url, og:locale and the EN/IT switch.

A RAW pair that no longer matches stops the build and names itself: the
English page changed, so update the pair. Text that comes out unchanged is
listed at the end so new English copy doesn't slip through untranslated.
Never edit it/ by hand: it is overwritten on every run.

File formats (scripts/it/):
  TEXT  *.txt      pairs of lines: the English text exactly as in the HTML source
                   (whitespace collapsed), then the Italian on a line starting
                   with "= ". An Italian line equal to the English marks a term
                   deliberately kept in English (Sankey, Data design...).
  RAW   *-raw.txt  "@@ [optional] [note]" starts a pair, the English lines
                   follow, then a line "==", then the Italian lines.
"""
import json
import os
import re
import sys
from urllib.parse import urljoin, urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TR = os.path.join(ROOT, 'scripts', 'it')
SITE = 'https://nutgraf.studio'

PAGES = [
    # key,          English source,           English path
    ('home',        'index.html',             '/'),
    ('workshops',   'workshops/index.html',   '/workshops/'),
    ('exhibitions', 'exhibitions/index.html', '/exhibitions/'),
    ('reports',     'reports/index.html',     '/reports/'),
]
PAGE_PATHS = {p[2] for p in PAGES}

# attributes whose value is read by people (or by search engines and screen readers)
TEXT_ATTRS = {'alt', 'aria-label', 'title', 'placeholder', 'content',
              'data-caption', 'data-title', 'data-alt', 'data-name', 'data-full',
              'data-short', 'data-tiny', 'data-report', 'data-label', 'data-text'}
URL_ATTRS = {'src', 'href', 'poster', 'srcset', 'data-src', 'data-srcset'}

TOKEN = re.compile(r'<!--.*?-->|<script\b[^>]*>.*?</script>|<style\b[^>]*>.*?</style>|<[^>]+>|[^<]+', re.S)
ATTR = re.compile(r'''(\s)([\w:.-]+)(\s*=\s*)("([^"]*)"|'([^']*)')''')
JSON_STR = re.compile(r'"((?:[^"\\]|\\.)*)"')
WS = re.compile(r'[ \t\r\n]+')
# a text node that is only a number ("7,688", "0.97%", "&lt;0.01%"): pages listed
# in NUMERIC_PAGES get Italian separators ("7.688", "0,97%")
NUMBER = re.compile(r'\s*(?:&lt;|[<>+\u2212\u00b1-])?\d[\d,.]*%?\s*')
NUMERIC_PAGES = {'reports'}
SWAP = str.maketrans({',': '.', '.': ','})


def norm(s):
    return WS.sub(' ', s).strip()


# ---------------------------------------------------------------- loading

def load_text():
    """All TEXT files merged into one dictionary, English -> Italian."""
    table, where = {}, {}
    for name in sorted(os.listdir(TR)):
        if not name.endswith('.txt') or name.endswith('-raw.txt'):
            continue
        lines = [l.rstrip('\n') for l in open(os.path.join(TR, name), encoding='utf-8')]
        lines = [(i + 1, l) for i, l in enumerate(lines) if l.strip() and not l.startswith('#')]
        if len(lines) % 2:
            sys.exit(f'{name}: odd number of lines, a pair is missing its other half')
        for (ln, en), (ln2, it) in zip(lines[0::2], lines[1::2]):
            if en.startswith('= ') or not it.startswith('= '):
                sys.exit(f'{name}:{ln}: expected an English line followed by a "= " Italian line')
            en, it = norm(en), it[2:].strip()
            if en in table and table[en] != it:
                sys.exit(f'{name}:{ln}: "{en}" is already translated differently in {where[en]}')
            table[en], where[en] = it, f'{name}:{ln2}'
    return table


def load_raw(key):
    """RAW pairs for one page: common-raw.txt first, then <page>-raw.txt."""
    pairs = []
    for name in ('common-raw.txt', f'{key}-raw.txt'):
        path = os.path.join(TR, name)
        if not os.path.exists(path):
            continue
        text = open(path, encoding='utf-8').read()
        for block in re.split(r'^@@', text, flags=re.M)[1:]:
            head, _, body = block.partition('\n')
            if '\n==\n' not in '\n' + body:
                sys.exit(f'{name}: pair "@@{head}" has no "==" line')
            en, it = ('\n' + body).split('\n==\n', 1)
            en = en[1:]
            it = it.rstrip('\n')
            # common pairs are optional: not every page has every block
            optional = 'optional' in head.split() or name == 'common-raw.txt'
            pairs.append((en, it, optional, f'{name} @@{head.strip()}'))
    return pairs


# ---------------------------------------------------------------- translating

def resolve(value, base):
    """A URL as the Italian page should write it."""
    v = value.strip()
    if not v or v.startswith(('#', 'mailto:', 'tel:', 'data:', 'javascript:')) or re.match(r'^[a-z]+://', v) or v.startswith('//'):
        return value
    absolute = urlsplit(urljoin(SITE + base, v))
    path = absolute.path
    if path in PAGE_PATHS:
        path = '/it' + path
    out = path
    if absolute.query:
        out += '?' + absolute.query
    if absolute.fragment:
        out += '#' + absolute.fragment
    return out


def translate_tag(tag, base, text, used):
    if tag.startswith(('</', '<!')):
        return tag

    def attr(m):
        sp, name, eq, quoted, dq, sq = m.groups()
        val = dq if dq is not None else sq
        q = '"' if dq is not None else "'"
        lname = name.lower()
        if lname in URL_ATTRS:
            if lname.endswith('srcset'):
                parts = []
                for part in val.split(','):
                    bits = part.strip().split(None, 1)
                    if bits:
                        bits[0] = resolve(bits[0], base)
                    parts.append(' '.join(bits))
                new = ', '.join(parts)
            else:
                new = resolve(val, base)
            return f'{sp}{name}{eq}{q}{new}{q}'
        if lname in TEXT_ATTRS:
            k = norm(val)
            if k in text:
                used.add(k)
                return f'{sp}{name}{eq}{q}{text[k]}{q}'
        return m.group(0)

    return ATTR.sub(attr, tag)


def translate_text_node(chunk, text, used, numbers=False):
    k = norm(chunk)
    if k and k in text:
        used.add(k)
        lead = chunk[:len(chunk) - len(chunk.lstrip(' \t\r\n'))]
        trail = chunk[len(chunk.rstrip(' \t\r\n')):]
        return lead + text[k] + trail
    if numbers and NUMBER.fullmatch(chunk):
        return chunk.translate(SWAP)
    return chunk


def translate_jsonld(block, text, used):
    def s(m):
        k = m.group(1)
        if k in text:
            used.add(k)
            return '"' + text[k].replace('\\', '\\\\').replace('"', '\\"') + '"'
        return m.group(0)
    open_tag, _, rest = block.partition('>')
    body, _, close = rest.rpartition('</script')
    body = JSON_STR.sub(s, body)
    try:
        json.loads(body)
    except ValueError as e:
        sys.exit(f'JSON-LD no longer parses after translation: {e}\n{body[:400]}')
    return open_tag + '>' + body + '</script' + close


def walk(src, base, text, used, numbers=False):
    out = []
    for m in TOKEN.finditer(src):
        t = m.group(0)
        if t.startswith('<!--') or t.startswith('<style'):
            out.append(t)
        elif t.startswith('<script'):
            if 'application/ld+json' in t[:80]:
                t = translate_jsonld(t, text, used)
            out.append(t)
        elif t.startswith('<'):
            out.append(translate_tag(t, base, text, used))
        else:
            out.append(translate_text_node(t, text, used, numbers))
    return ''.join(out)


def nodes(src):
    """(line, kind, text) for every human-readable string outside scripts and styles."""
    found = []
    for m in TOKEN.finditer(src):
        t = m.group(0)
        line = src.count('\n', 0, m.start()) + 1
        if t.startswith('<script') and 'application/ld+json' in t[:80]:
            for j in JSON_STR.finditer(t):
                if ' ' in j.group(1) and not j.group(1).startswith('http'):
                    found.append((src.count('\n', 0, m.start() + j.start()) + 1, 'json', j.group(1)))
            continue
        if t.startswith(('<!--', '<style', '<script')):
            continue
        if t.startswith('<'):
            for a in ATTR.finditer(t):
                if a.group(2).lower() in TEXT_ATTRS:
                    val = a.group(5) if a.group(5) is not None else a.group(6)
                    # meta content is prose only in descriptions, titles and alt text
                    if a.group(2).lower() == 'content' and (' ' not in val or '=' in val or val.startswith('index,')):
                        continue
                    found.append((line, a.group(2), norm(val)))
        else:
            found.append((line, 'text', norm(t)))
    return [f for f in found if re.search(r'[A-Za-z]{2,}', f[2])]


def build(key, src_rel, path, text, show_js, src_root=ROOT):
    src = open(os.path.join(src_root, src_rel), encoding='utf-8').read()
    out = src
    problems = []

    # 1. RAW pairs
    for en, it, optional, label in load_raw(key):
        n = out.count(en)
        if n == 0:
            if not optional:
                problems.append(f'  no longer matches: {label}\n    {en[:160]!r}')
            continue
        out = out.replace(en, it)

    # 2-3. text, attributes, structured data, paths
    used = set()
    out = walk(out, path, text, used, key in NUMERIC_PAGES)

    # 4. the page itself
    it_path = '/it' + path
    out = out.replace('<html lang="en-GB">', '<html lang="it">', 1)
    for attr_name in ('rel="canonical" href=', 'property="og:url" content='):
        out = out.replace(f'{attr_name}"{SITE}{path}"', f'{attr_name}"{SITE}{it_path}"')
    out = out.replace('<meta property="og:locale" content="en_GB">',
                      '<meta property="og:locale" content="it_IT">\n<meta property="og:locale:alternate" content="en_GB">')
    # the page's language; a report's own "inLanguage": "en" stays as it is
    out = out.replace('"inLanguage": "en-GB"', '"inLanguage": "it-IT"')
    # EN/IT switch: the English page links here, the Italian page links back
    out = re.sub(r'(<a class="lang-switch[^"]*" href=")/it(/[^"]*)" hreflang="it" lang="it"',
                 r'\1\2" hreflang="en" lang="en"', out)
    out = out.replace('title="Italiano">IT</a>', 'title="English">EN</a>')
    out = out.replace('lang="en">Italiano</a>', 'lang="en">English</a>')
    out = out.replace('<!DOCTYPE html>',
                      '<!DOCTYPE html>\n<!-- Italian edition, generated by scripts/build_it.py from /'
                      + src_rel + '. Edit the English page or scripts/it/, then rerun; '
                      'changes made here are overwritten. -->', 1)

    for must in ('<html lang="it">', f'rel="canonical" href="{SITE}{it_path}"',
                 f'hreflang="it" href="{SITE}{it_path}"'):
        if must not in out:
            problems.append(f'  missing after build: {must}')

    dest = os.path.join(ROOT, 'it', path.strip('/'), 'index.html')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(out)

    # what's still English
    kept = set(text.values())
    english = {n[2] for n in nodes(src)}
    left, seen = [], set()
    for line, kind, val in nodes(out):
        if val in english and val not in kept and (kind, val) not in seen:
            seen.add((kind, val))
            left.append((kind, val))
    src_lines = {}
    for line, kind, val in nodes(src):
        src_lines.setdefault((kind, val), line)
    left.sort(key=lambda kv: src_lines.get(kv, 0))

    # stray relative asset paths inside scripts
    stray = sorted(set(re.findall(r"""['"](?:img|media|logos)/[^'"]*""", ''.join(
        m.group(0) for m in TOKEN.finditer(out) if m.group(0).startswith('<script')))))

    print(f'{key}: wrote it{path}index.html')
    for p in problems:
        print(p)
    for kind, val in left:
        print(f'  still English ({kind}, line {src_lines.get((kind, val), "?")}): {val}')
    for s in stray:
        print(f'  relative path in a script: {s}')
    if show_js:
        lits = set()
        for m in TOKEN.finditer(out):
            t = m.group(0)
            if t.startswith('<script') and 'ld+json' not in t[:80]:
                lits.update(re.findall(r"'([^'\n]*[A-Za-z]{2,} [^'\n]*)'", t))
        for l in sorted(lits):
            print(f'  js: {l}')
    return not problems


def main():
    args = sys.argv[1:]
    show_js = '--js' in args
    src_root = ROOT
    if '--src' in args:
        i = args.index('--src')
        src_root = os.path.abspath(args[i + 1])
        del args[i:i + 2]
    only = [a for a in args if not a.startswith('--')]
    text = load_text()
    ok = True
    for key, src_rel, path in PAGES:
        if only and key not in only:
            continue
        ok &= build(key, src_rel, path, text, show_js, src_root)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
