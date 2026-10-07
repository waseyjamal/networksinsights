# Makes the E2E fixtures and reference outputs of Image Upscaler and Background Remover
# (apps/web/e2e/fixtures/README.md, ADR 0066). Run it in the same throwaway environment as
# convert-realesrgan.py:
#
#   curl -L -o ochoa.jpg https://upload.wikimedia.org/wikipedia/commons/e/e8/Ellen_Ochoa.jpg
#   venv/Scripts/python scripts/models/make-fixtures.py ochoa.jpg realesr-general-x4v3.pth \
#     models/modnet/model.onnx apps/web/e2e/fixtures
#
# The source photo is NASA's official portrait of astronaut Ellen Ochoa (public domain, a work of
# the US federal government). Every reference here comes from the original model: PyTorch for
# Real-ESRGAN, the published ONNX file run by onnxruntime for MODNet. The script also checks that
# cutting the picture into tiles as logic.ts does gives the same result as one run, and prints the
# differences the end-to-end tolerances come from.

import sys
import importlib.util
from pathlib import Path

import numpy as np
import onnxruntime
import torch
from PIL import Image

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location("convert", here / "convert-realesrgan.py")
convert = importlib.util.module_from_spec(spec)
spec.loader.exec_module(convert)

TILE, HALO, SCALE = 192, 34, 4


def realesrgan(weights):
    model = convert.SRVGGNetCompact()
    model.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True)["params"])
    return model.eval()


def run(model, rgb):
    x = torch.from_numpy(rgb.transpose(2, 0, 1)[None].astype(np.float32) / 255)
    with torch.no_grad():
        return model(x)[0].numpy().transpose(1, 2, 0)


def tiled(model, rgb):
    h, w, _ = rgb.shape
    out = np.zeros((h * SCALE, w * SCALE, 3), np.float32)
    for y in range(0, h, TILE):
        for x in range(0, w, TILE):
            th, tw = min(TILE, h - y), min(TILE, w - x)
            iy, ix = max(0, y - HALO), max(0, x - HALO)
            part = run(model, rgb[iy : min(h, y + th + HALO), ix : min(w, x + tw + HALO)])
            oy, ox = (y - iy) * SCALE, (x - ix) * SCALE
            out[y * SCALE : (y + th) * SCALE, x * SCALE : (x + tw) * SCALE] = part[
                oy : oy + th * SCALE, ox : ox + tw * SCALE
            ]
    return out


def to8(a):
    return np.clip(np.rint(a * 255), 0, 255).astype(np.uint8)


def main(photo, weights, modnet, folder):
    folder = Path(folder)
    source = Image.open(photo).convert("RGB")

    # Upscaler: the face, 224 × 96 pixels, two tiles wide.
    face = source.crop((1150, 950, 2270, 1430)).resize((224, 96), Image.LANCZOS)
    face.save(folder / "upscale-face.png", optimize=True)
    rgb = np.asarray(face)
    model = realesrgan(weights)
    whole = to8(run(model, rgb))
    pieces = to8(tiled(model, rgb))
    print("tiled against one run, largest 8-bit difference:", int(np.abs(whole.astype(int) - pieces).max()))
    Image.fromarray(whole).save(folder / "upscale-face-4x.png", optimize=True)

    # Background remover: the whole portrait at 512 × 640, the size MODNet sees it at.
    portrait = source.resize((512, 640), Image.LANCZOS)
    portrait.save(folder / "portrait.png", optimize=True)
    x = (np.asarray(portrait).astype(np.float32) / 127.5 - 1).transpose(2, 0, 1)[None]
    mattes = []
    for level in [
        onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL,
        onnxruntime.GraphOptimizationLevel.ORT_DISABLE_ALL,
    ]:
        options = onnxruntime.SessionOptions()
        options.graph_optimization_level = level
        session = onnxruntime.InferenceSession(modnet, options, providers=["CPUExecutionProvider"])
        mattes.append(to8(session.run(None, {"input": x})[0][0, 0]))
    print(
        "MODNet, optimised against plain graph, largest 8-bit difference:",
        int(np.abs(mattes[0].astype(int) - mattes[1]).max()),
    )
    Image.fromarray(mattes[0], "L").save(folder / "portrait-matte.png", optimize=True)
    m = mattes[0].astype(np.float32) / 255
    print("matte, top corners 64 × 64 mean:", float(m[:64, :64].mean()), float(m[:64, -64:].mean()))
    print("matte, face box mean:", float(m[150:300, 190:320].mean()))


if __name__ == "__main__":
    main(*sys.argv[1:5])
