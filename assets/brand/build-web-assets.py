"""Bangun aset web (apps/web/public/brand) dari sumber di assets/brand.

Jalankan dari root repo: python3 assets/brand/build-web-assets.py  (butuh Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SRC = Path(__file__).resolve().parent
ROOT = SRC.parent.parent
PUB = ROOT / 'apps/web/public'
OUT = PUB / 'brand'
OUT.mkdir(parents=True, exist_ok=True)


def remove_bg(img: Image.Image, tol: int = 40, band: int = 3) -> Image.Image:
    """Hapus latar polos yang tersambung ke tepi gambar; tepi dihaluskan dengan un-mix warna latar."""
    if img.mode == 'RGBA' and img.getchannel('A').getextrema()[0] < 255:
        return img.crop(img.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox())  # sumber sudah transparan
    img = img.convert('RGB')
    w, h = img.size
    bg = img.getpixel((2, 2))
    # Mask latar: flood fill dari keempat sudut pada salinan gambar.
    probe = img.copy()
    marker = (255, 0, 255) if bg != (255, 0, 255) else (0, 255, 0)
    for xy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if probe.getpixel(xy) != marker:
            ImageDraw.floodfill(probe, xy, marker, thresh=tol)
    mask = Image.new('L', (w, h), 0)
    mp, pp = mask.load(), probe.load()
    for y in range(h):
        for x in range(w):
            if pp[x, y] == marker:
                mp[x, y] = 255
    # Pita tepi: piksel non-latar dekat latar → alpha parsial.
    near = mask.filter(ImageFilter.MaxFilter(band * 2 + 1))
    rgba = img.convert('RGBA')
    px, nm = rgba.load(), near.load()
    ref = 140.0
    for y in range(h):
        for x in range(w):
            if mp[x, y]:
                px[x, y] = (0, 0, 0, 0)
            elif nm[x, y]:
                r, g, b, _ = px[x, y]
                d = max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2]))
                a = min(1.0, d / ref)
                if a <= 0.02:
                    px[x, y] = (0, 0, 0, 0)
                    continue
                un = [round(bg[i] + (c - bg[i]) / a) for i, c in enumerate((r, g, b))]
                px[x, y] = (*[max(0, min(255, v)) for v in un], round(a * 255))
    return rgba.crop(rgba.getbbox())


def fit_height(img: Image.Image, h: int) -> Image.Image:
    return img.resize((round(img.width * h / img.height), h), Image.LANCZOS)


def fit_width(img: Image.Image, w: int) -> Image.Image:
    return img.resize((w, round(img.height * w / img.width)), Image.LANCZOS)


# Logo horizontal terang & gelap (tinggi 2x untuk layar retina).
for name in ('logo-light', 'logo-dark'):
    fit_height(remove_bg(Image.open(SRC / f'{name}.png')), 160).save(OUT / f'{name}.png', optimize=True)

# Ikon aplikasi: sudut di luar rounded-square jadi transparan.
icon = remove_bg(Image.open(SRC / 'app-icon.png'), tol=30, band=2)
side = max(icon.size)
sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
sq.paste(icon, ((side - icon.width) // 2, (side - icon.height) // 2))
for s in (16, 32, 48, 64, 192, 512):
    sq.resize((s, s), Image.LANCZOS).save(OUT / f'icon-{s}.png', optimize=True)
# apple-touch-icon tanpa transparansi (iOS mengisi hitam), latar violet.
apple = Image.new('RGB', (side, side), (124, 58, 237))
apple.paste(sq, (0, 0), sq)
apple.resize((180, 180), Image.LANCZOS).save(OUT / 'apple-touch-icon.png', optimize=True)
sq.resize((64, 64), Image.LANCZOS).save(PUB / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

# Ikon jenis unit.
for name in ('icon-billiard', 'icon-playstation'):
    fit_height(remove_bg(Image.open(SRC / f'{name}.png')), 96).save(OUT / f'{name}.png', optimize=True)

# Ilustrasi empty state.
for name in ('empty-units', 'empty-device-offline'):  # empty-transactions disimpan untuk M2
    fit_width(remove_bg(Image.open(SRC / f'{name}.png')), 480).save(OUT / f'{name}.webp', quality=88)

# Ilustrasi login: logo konsol bermerek di layar TV diganti ikon FunPlay (hindari merek dagang pihak ketiga).
login = Image.open(SRC / 'login-illustration.png').convert('RGB')
box = (890, 335, 1045, 455)
ring = [login.getpixel((x, y)) for x in range(box[0] - 8, box[2] + 8, 4) for y in (box[1] - 8, box[3] + 8)]
fill = tuple(sorted(c[i] for c in ring)[len(ring) // 2] for i in range(3))
mask = Image.new('L', login.size, 0)
ImageDraw.Draw(mask).rounded_rectangle(box, radius=30, fill=255)
login.paste(Image.new('RGB', login.size, fill), (0, 0), mask.filter(ImageFilter.GaussianBlur(10)))
mark = sq.resize((100, 100), Image.LANCZOS)
login.paste(mark, ((box[0] + box[2]) // 2 - 50, (box[1] + box[3]) // 2 - 50), mark)
fit_width(login, 1100).save(OUT / 'login-illustration.webp', quality=85)

print('ok:', sorted(p.name for p in OUT.iterdir()))
