# U²-Netp model

`u2netp.onnx` is the U²-Netp salient object detection model, run by Background Remover on the
visitor's device (ADR 0057). It is served from this site as a hashed file and never changed here.

| | |
|---|---|
| Model | U²-Netp, the small U²-Net (Qin et al., 2020) |
| Weights | `u2netp.pth`, published by the authors in [xuebinqin/U-2-Net](https://github.com/xuebinqin/U-2-Net) (commit `ac7e1c817ecab7c7dff5ce6b1abba61cd213ff29` checked) |
| Weights licence | Apache-2.0, the repository's `LICENSE`, copied as `LICENSE` next to this file |
| ONNX file from | <https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx>, the ONNX export of those weights that rembg (MIT) ships; release asset uploaded 2022-11-24 |
| Size | 4,574,861 bytes |
| SHA-256 | `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` |
| Input | `1 × 3 × 320 × 320` float32, RGB scaled by the brightest value, ImageNet mean and std |
| Output | first output, `1 × 1 × 320 × 320`, stretched to 0–1 by its minimum and maximum |

GitHub publishes no digest for that release asset, so the SHA-256 above is the one measured when
the file was added (2026-10-02). `logic.test.ts` checks the file against it, so a changed file
fails the tests.

## Credit

U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection. Xuebin Qin, Zichen
Zhang, Chenyang Huang, Masood Dehghan, Osmar R. Zaiane and Martin Jagersand. Pattern Recognition
106, 107404 (2020). Licensed under the Apache License, Version 2.0.

## Updating

Download the new file, check where its weights come from and their licence, record the source,
size and SHA-256 here, update `DOWNLOAD_BYTES.model` in `logic.ts`, and run the tool's tests.
