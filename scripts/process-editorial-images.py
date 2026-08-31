from pathlib import Path

from PIL import Image, ImageCms


BLOG_ROOT = Path(__file__).resolve().parent.parent
ORIGINALS_ROOT = BLOG_ROOT / "imagegen-originals"
POSTS_ROOT = BLOG_ROOT / "posts"
MAX_EDGE = 1280
JPEG_QUALITY = 75


def final_jpeg_for(post_number: int) -> Path:
    candidates = sorted((POSTS_ROOT / str(post_number)).glob("*.jpg"))
    if len(candidates) != 1:
        raise RuntimeError(
            f"Se esperaba un JPG en posts/{post_number}, encontrados: {len(candidates)}"
        )
    return candidates[0]


def original_for(post_number: int) -> Path:
    candidates = sorted(ORIGINALS_ROOT.glob(f"{post_number:02d}-*.png"))
    if len(candidates) != 1:
        raise RuntimeError(
            f"Se esperaba un original PNG para la entrada {post_number}, "
            f"encontrados: {len(candidates)}"
        )
    return candidates[0]


srgb_profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
srgb_bytes = srgb_profile.tobytes()

for number in range(1, 31):
    source = original_for(number)
    destination = final_jpeg_for(number)
    with Image.open(source) as image:
        rgb = image.convert("RGB")
        rgb.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
        rgb.save(
            destination,
            format="JPEG",
            quality=JPEG_QUALITY,
            optimize=True,
            progressive=True,
            icc_profile=srgb_bytes,
        )

print("30 imágenes convertidas a JPG sRGB, calidad 75 y lado máximo 1280 px.")
