# Pixel diff of each styling case against the shipping annotator ('current').
import sys
from PIL import Image, ImageChops
variants = sys.argv[1:]
cases = ['link','heading','bolditalic','pre','flex','rtl','clamp','ellipsis','justify','hostile','descendant','firstline','firstletter','transform','spacing','selection']
for c in cases:
    ref = Image.open(f'/tmp/zs-eval/style-current-{c}.png').convert('RGB')
    row = [c]
    for v in variants:
        im = Image.open(f'/tmp/zs-eval/style-{v}-{c}.png').convert('RGB')
        if im.size != ref.size:
            row.append(f'{v}: size {im.size} vs {ref.size}')
            continue
        d = ImageChops.difference(ref, im)
        n = sum(1 for p in d.getdata() if max(p) > 40)
        row.append(f'{v}: {n}px')
    print('  '.join(row))
