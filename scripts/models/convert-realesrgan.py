# Converts Real-ESRGAN's realesr-general-x4v3 weights to the ONNX file the Image Upscaler serves
# (ADR 0066). Run it by hand in a throwaway virtual environment outside the repository; nothing here
# is a dependency of the project. Exact versions, as used for the committed file:
#
#   python -m venv venv
#   venv/Scripts/python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0
#   venv/Scripts/python -m pip install onnx==1.19.0 onnxruntime==1.23.0 numpy==2.3.3 \
#     pillow==11.3.0 onnxscript==0.5.3
#   curl -L -o realesr-general-x4v3.pth \
#     https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth
#   venv/Scripts/python scripts/models/convert-realesrgan.py realesr-general-x4v3.pth out.onnx
#
# The network is SRVGGNetCompact from realesrgan/archs/srvgg_arch.py (BSD-3-Clause, Xintao Wang),
# written out here so the conversion needs neither realesrgan nor basicsr. The weights are loaded
# strictly, so a key that does not match fails the conversion. After export, the script runs the
# ONNX file with onnxruntime and PyTorch on the same three inputs and prints the largest difference
# in 8-bit levels: that number is where the end-to-end test tolerance comes from.

import hashlib
import sys

import numpy as np
import onnxruntime
import torch
from torch import nn
from torch.nn import functional as F


class SRVGGNetCompact(nn.Module):
    def __init__(self, num_feat=64, num_conv=32, upscale=4):
        super().__init__()
        self.upscale = upscale
        self.body = nn.ModuleList()
        self.body.append(nn.Conv2d(3, num_feat, 3, 1, 1))
        self.body.append(nn.PReLU(num_parameters=num_feat))
        for _ in range(num_conv):
            self.body.append(nn.Conv2d(num_feat, num_feat, 3, 1, 1))
            self.body.append(nn.PReLU(num_parameters=num_feat))
        self.body.append(nn.Conv2d(num_feat, 3 * upscale * upscale, 3, 1, 1))
        self.upsampler = nn.PixelShuffle(upscale)

    def forward(self, x):
        out = x
        for layer in self.body:
            out = layer(out)
        out = self.upsampler(out)
        return out + F.interpolate(x, scale_factor=self.upscale, mode="nearest")


def main(weights_path, onnx_path):
    model = SRVGGNetCompact()
    state = torch.load(weights_path, map_location="cpu", weights_only=True)
    model.load_state_dict(state["params"], strict=True)
    model.eval()

    example = torch.rand(1, 3, 64, 64)
    torch.onnx.export(
        model,
        (example,),
        onnx_path,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {2: "height", 3: "width"}, "output": {2: "height4", 3: "width4"}},
        opset_version=17,
        dynamo=False,
    )

    session = onnxruntime.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(66)
    worst = 0
    for height, width in [(64, 64), (128, 96), (37, 53)]:
        x = rng.random((1, 3, height, width), dtype=np.float32)
        with torch.no_grad():
            expected = model(torch.from_numpy(x)).numpy()
        actual = session.run(None, {"input": x})[0]
        assert actual.shape == (1, 3, height * 4, width * 4), actual.shape
        to8 = lambda a: np.clip(np.rint(a * 255), 0, 255).astype(np.int16)
        worst = max(worst, int(np.abs(to8(actual) - to8(expected)).max()))
        print(f"{height}x{width}: max float diff {float(np.abs(actual - expected).max()):.2e}")
    print(f"largest 8-bit difference, onnxruntime against PyTorch: {worst}")

    with open(onnx_path, "rb") as file:
        print("sha256", hashlib.sha256(file.read()).hexdigest())


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
