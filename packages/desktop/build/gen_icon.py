"""Generate the DocVault app icon as a 1024px PNG.

Concept: a document page with a folded corner and a keyhole — "secure docs",
distinct from a ship's-wheel/helm shape. Uses numpy signed-distance fields for
crisp anti-aliasing and writes a PNG via the stdlib (zlib) — no image deps.
"""
import math
import struct
import sys
import zlib
import numpy as np

N = 1024
y, x = np.mgrid[0:N, 0:N].astype(np.float64)


def rrect(px, py, ox, oy, hw, hh, r):
    qx = np.abs(px - ox) - hw + r
    qy = np.abs(py - oy) - hh + r
    outside = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2)
    inside = np.minimum(np.maximum(qx, qy), 0)
    return outside + inside - r


def circle(px, py, ox, oy, r):
    return np.sqrt((px - ox) ** 2 + (py - oy) ** 2) - r


def convex(px, py, pts):
    """Signed distance to a convex polygon (negative inside)."""
    cxp = sum(p[0] for p in pts) / len(pts)
    cyp = sum(p[1] for p in pts) / len(pts)
    d = None
    for i in range(len(pts)):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % len(pts)]
        nx, ny = (by - ay), -(bx - ax)
        L = math.hypot(nx, ny)
        nx, ny = nx / L, ny / L
        hp = (px - ax) * nx + (py - ay) * ny
        if (cxp - ax) * nx + (cyp - ay) * ny > 0:
            hp = -hp
        d = hp if d is None else np.maximum(d, hp)
    return d


def cov(sdf):
    return np.clip(0.5 - sdf, 0.0, 1.0)


rgb = np.zeros((N, N, 3))
alpha = np.zeros((N, N))


def over(src_rgb, src_a2d):
    global rgb, alpha
    a = src_a2d
    out_a = a + alpha * (1 - a)
    safe = np.where(out_a > 1e-6, out_a, 1.0)
    rgb = (src_rgb * a[..., None] + rgb * alpha[..., None] * (1 - a[..., None])) / safe[..., None]
    alpha = out_a


# --- Background squircle: diagonal deep-orange -> amber gradient + top highlight ---
t = np.clip((x + y) / (2.0 * N), 0, 1)
c0 = np.array([194, 65, 12])    # orange-700  #c2410c
c1 = np.array([251, 146, 60])   # orange-400  #fb923c
bg = c0 * (1 - t[..., None]) + c1 * t[..., None]
glow = np.exp(-(((x - 340) ** 2 + (y - 300) ** 2) / (2 * 430 ** 2)))
bg = np.clip(bg + glow[..., None] * 42, 0, 255)
over(bg, cov(rrect(x, y, N / 2, N / 2, 430, 430, 232)))

WHITE = np.ones((N, N, 3)) * 255
PAGE = np.ones((N, N, 3)) * 255

# Page geometry
pcx, pcy, hw, hh, pr = 512.0, 522.0, 212.0, 274.0, 40.0
left, right = pcx - hw, pcx + hw
top, bot = pcy - hh, pcy + hh
F = 104.0  # folded-corner size

# --- Faint back page for depth (offset up-right) ---
over(WHITE, cov(rrect(x, y, pcx + 30, pcy - 30, hw, hh, pr)) * 0.32)

# --- Front page (mask out the folded corner triangle) ---
page_cov = cov(rrect(x, y, pcx, pcy, hw, hh, pr))
cut = cov(convex(x, y, [(right - F, top), (right + 5, top), (right + 5, top + F)]))
page_cov = np.clip(page_cov - cut, 0, 1)
over(PAGE, page_cov)

# --- Folded corner underside (light grey triangle) ---
fold = convex(x, y, [(right - F, top), (right, top + F), (right - F, top + F)])
over(np.array([214, 219, 230]), cov(fold))

# --- Keyhole (background gradient shows through the page) ---
kcx, kcy = pcx, 470.0
hole_circle = cov(circle(x, y, kcx, kcy, 54))
hole_stem = cov(convex(x, y, [(kcx - 24, kcy + 168), (kcx + 24, kcy + 168), (kcx + 16, kcy), (kcx - 16, kcy)]))
keyhole = np.maximum(hole_circle, hole_stem)
over(bg, keyhole)

# --- Two text lines below the keyhole (gradient bars) ---
for ly, lw in ((712, 150), (760, 110)):
    over(bg, cov(rrect(x, y, pcx - (150 - lw), ly, lw, 17, 17)) * 0.9)

# Compose to straight-alpha RGBA bytes
out = np.zeros((N, N, 4), dtype=np.uint8)
out[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
out[..., 3] = np.clip(alpha * 255, 0, 255).astype(np.uint8)


def write_png(path, arr):
    h, w, _ = arr.shape
    raw = bytearray()
    for row in range(h):
        raw.append(0)
        raw.extend(arr[row].tobytes())
    comp = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(
            ">I", zlib.crc32(tag + data) & 0xFFFFFFFF
        )

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", comp))
        f.write(chunk(b"IEND", b""))


write_png(sys.argv[1] if len(sys.argv) > 1 else "icon.png", out)
print("wrote icon")
