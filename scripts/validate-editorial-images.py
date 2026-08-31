import hashlib
import io
import json
from pathlib import Path

from PIL import Image, ImageCms


ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "image-manifest.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def difference_hash(image: Image.Image) -> int:
    sample = image.convert("L").resize((17, 16), Image.Resampling.LANCZOS)
    pixels = list(sample.get_flattened_data())
    value = 0
    bit = 0
    for row in range(16):
        offset = row * 17
        for column in range(16):
            if pixels[offset + column] > pixels[offset + column + 1]:
                value |= 1 << bit
            bit += 1
    return value


manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
errors = []
final_hashes = set()
original_hashes = set()
dimensions = set()
profiles = set()
perceptual_hashes = []
total_final_bytes = 0

for item in manifest["items"]:
    number = item["number"]
    original = ROOT / Path(item["original"])
    final = ROOT / Path(item["final"])
    if not original.is_file():
        errors.append(f"Falta el original de la entrada {number}")
        continue
    if not final.is_file():
        errors.append(f"Falta el JPG de la entrada {number}")
        continue

    original_digest = sha256(original)
    final_digest = sha256(final)
    original_hashes.add(original_digest)
    final_hashes.add(final_digest)
    if original_digest != item["original_sha256"]:
        errors.append(f"Hash original incorrecto en la entrada {number}")
    if final_digest != item["final_sha256"]:
        errors.append(f"Hash final incorrecto en la entrada {number}")

    with Image.open(original) as source:
        if source.format != "PNG":
            errors.append(f"El original {number} no es PNG")

    with Image.open(final) as image:
        total_final_bytes += final.stat().st_size
        dimensions.add(image.size)
        if image.format != "JPEG":
            errors.append(f"La imagen final {number} no es JPEG")
        if image.mode != "RGB":
            errors.append(f"La imagen final {number} no está en modo RGB")
        if max(image.size) > 1280:
            errors.append(f"La imagen final {number} supera 1280 px")
        if min(image.size) < 700:
            errors.append(f"La imagen final {number} tiene resolución insuficiente")
        icc_bytes = image.info.get("icc_profile")
        if not icc_bytes:
            errors.append(f"La imagen final {number} no contiene perfil ICC")
        else:
            profile = ImageCms.ImageCmsProfile(io.BytesIO(icc_bytes))
            description = ImageCms.getProfileDescription(profile).strip()
            profiles.add(description)
            if "sRGB" not in description:
                errors.append(f"El perfil de la imagen {number} no es sRGB: {description}")
        perceptual_hashes.append((number, difference_hash(image)))

if len(original_hashes) != 30:
    errors.append(f"Solo hay {len(original_hashes)} originales con hash único")
if len(final_hashes) != 30:
    errors.append(f"Solo hay {len(final_hashes)} JPG con hash único")

closest_pair = None
for index, (left_number, left_hash) in enumerate(perceptual_hashes):
    for right_number, right_hash in perceptual_hashes[index + 1 :]:
        distance = (left_hash ^ right_hash).bit_count()
        if closest_pair is None or distance < closest_pair[2]:
            closest_pair = (left_number, right_number, distance)

report = {
    "status": "fail" if errors else "pass",
    "images": len(manifest["items"]),
    "unique_original_sha256": len(original_hashes),
    "unique_final_sha256": len(final_hashes),
    "dimensions": sorted(f"{width}x{height}" for width, height in dimensions),
    "profiles": sorted(profiles),
    "format": "JPEG",
    "mode": "RGB",
    "quality_target": 75,
    "maximum_edge_px": 1280,
    "total_final_bytes": total_final_bytes,
    "closest_perceptual_pair": {
        "left": closest_pair[0],
        "right": closest_pair[1],
        "hamming_distance_256": closest_pair[2],
    }
    if closest_pair
    else None,
    "errors": errors,
}
print(json.dumps(report, ensure_ascii=False, indent=2))
if errors:
    raise SystemExit(1)
