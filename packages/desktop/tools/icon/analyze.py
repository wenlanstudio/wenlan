import numpy as np
from PIL import Image

def load_mask(path, thresh=140):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    lum = a @ np.array([0.299, 0.587, 0.114])
    return im, lum, lum > thresh

for p in [r'C:/Users/Yuan/Downloads/文1.jpeg',
          r'D:/md-ecosystem/wenlan-studio/packages/desktop/static/icon-source.jpg',
          r'D:/md-ecosystem/wenlan-studio/packages/desktop/build/icons/icon.png']:
    im, lum, m = load_mask(p)
    ys, xs = np.nonzero(m)
    print(p.split('\\')[-1], im.size, 'glyph bbox x[%d,%d] y[%d,%d]' % (xs.min(), xs.max(), ys.min(), ys.max()),
          'coverage %.3f' % m.mean())

# compare glyph masks of user file vs current icon.png
def mask_of(path, thresh=140):
    im = Image.open(path).convert("RGB").resize((512, 512), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    lum = a @ np.array([0.299, 0.587, 0.114])
    return lum > thresh

m1 = mask_of(r'C:/Users/Yuan/Downloads/文1.jpeg')
m2 = mask_of(r'D:/md-ecosystem/wenlan-studio/packages/desktop/build/icons/icon.png')
m3 = mask_of(r'D:/md-ecosystem/wenlan-studio/packages/desktop/static/icon-source.jpg')
inter = (m1 & m2).sum(); union = (m1 | m2).sum()
print('IoU 文1 vs icon.png = %.4f' % (inter / union))
inter = (m1 & m3).sum(); union = (m1 | m3).sum()
print('IoU 文1 vs icon-source.jpg = %.4f' % (inter / union))
