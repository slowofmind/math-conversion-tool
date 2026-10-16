# apply-patch.py — applies a ---8<--- patch file to a copy of a file, each anchor exactly
# once, all or nothing (for checking the patch here; the desktop uses its own patcher).
#   python apply-patch.py <patch.txt> <file-to-patch> <output-file>
import sys, re
patch, src, out = sys.argv[1:4]
text = open(src, encoding='utf-8').read()
body = open(patch, encoding='utf-8').read().split('---8<--- FILE\n', 1)[1].split('\n', 1)[1]
blocks = re.findall(r'---8<--- ANCHOR\n(.*?)\n---8<--- REPLACEMENT\n(.*?)\n---8<--- END\n', body, re.S)
for i, (a, r) in enumerate(blocks, 1):
    n = text.count(a)
    if n != 1: sys.exit(f'patch {i}: anchor found {n} times; nothing written')
    text = text.replace(a, r)
open(out, 'w', encoding='utf-8').write(text)
print(f'{len(blocks)} patches applied')
