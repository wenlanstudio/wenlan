import numpy as np
from PIL import Image

SRC = r'D:/md-ecosystem/wenlan-studio/packages/desktop/build/icons/icon.png'
OUT = r'D:/md-ecosystem/wenlan-studio/packages/desktop/tools/icon'

im = Image.open(SRC).convert('RGBA')
rgb = np.asarray(im)[..., :3].astype(np.float32)
alpha = np.asarray(im)[..., 3].astype(np.float32)
lum = rgb @ np.array([0.299, 0.587, 0.114])
a = np.clip((lum - 70) / (150 - 70), 0, 1) * (alpha > 0)
m = a > 0.5
ys, xs = np.nonzero(m)
print('glyph bbox x[%d,%d] y[%d,%d]' % (xs.min(), xs.max(), ys.min(), ys.max()))

# best symmetry axis: minimize XOR between mask and its mirror
best = None
for axis2 in range(2 * 400, 2 * 630):          # axis2 = 2*axis (float axis)
    mirrored = np.roll(m[:, ::-1], axis2 // 2 + 1, axis=1) if False else None
# do it properly: for float axis, mirror index = axis2 - x
def mirror(m, axis2):
    n = m.shape[1]
    out = np.zeros_like(m)
    x0 = int(np.floor(axis2)) - n
    x1 = int(np.ceil(axis2)) + n
    for x in range(n):
        sx = axis2 - x
        if 0 <= sx < n:
            out[:, x] = m[:, int(round(sx))]
    return out

best = (1e9, None)
for axis in np.arange(400, 630, 0.5):
    mm = mirror(m, 2 * axis)
    inter = (m & mm).sum(); union = (m | mm).sum()
    iou = inter / union
    if iou > best[0]:
        best = (iou, axis)
print('best axis = %.1f  IoU=%.4f  (canvas center=512, bbox center=%.1f)' % (best[1], best[0], (xs.min()+xs.max())/2))

axis = best[1]
mm = mirror(m, 2*axis)
diff = m ^ mm
print('mismatched glyph pixels: %d (%.2f%% of glyph)' % (diff.sum(), 100*diff.sum()/m.sum()))

# where is the mismatch? per-row and per-column profile
rows = diff.sum(axis=1)
top = np.argsort(rows)[-12:][::-1]
print('top mismatch rows:', [(int(r), int(rows[r])) for r in top])
cols = diff.sum(axis=0)
print('mismatch column range: x[%d..%d]' % (np.nonzero(cols)[0].min(), np.nonzero(cols)[0].max()))

# diagnostic overlay: left half red, mirrored right half cyan
ov = np.zeros((1024, 1024, 3), np.float32)
ov[..., 0] = m * 255
ov[..., 1] = mm * 255
Image.fromarray(ov.astype(np.uint8)).save(OUT + '/diag_overlay.png')

# side-by-side: left in red, right in cyan (non-overlapping halves)
half = np.zeros((1024, 1024, 3), np.float32)
left = m.copy(); left[:, int(axis)+1:] = False
right = mm.copy(); right[:, :int(axis)] = False
half[..., 0] = left * 255; half[..., 1] = right * 255
Image.fromarray(half.astype(np.uint8)).save(OUT + '/diag_halves.png')
print('wrote diag_overlay.png / diag_halves.png')
