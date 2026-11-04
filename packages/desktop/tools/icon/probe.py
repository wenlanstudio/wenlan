import numpy as np
from PIL import Image

p = r'D:/md-ecosystem/wenlan-studio/packages/desktop/build/icons/icon.png'
im = Image.open(p).convert('RGBA')
a = np.asarray(im)
alpha = a[..., 3]
print('alpha min/max/mean', alpha.min(), alpha.max(), alpha.mean())
# corner samples
for (y, x) in [(0,0), (5,5), (20,20), (512, 5), (5, 512), (512,512)]:
    print('px', (y,x), a[y, x])

src = r'D:/md-ecosystem/wenlan-studio/packages/desktop/static/icon-source.jpg'
j = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
lum = j @ np.array([0.299, 0.587, 0.114])
mask = lum > 140
print('glyph color sample (mean of bright px):', j[mask].mean(axis=0))
print('bg color sample (corners):', j[20,20], j[1000,60])
