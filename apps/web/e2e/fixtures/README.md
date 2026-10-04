# E2E fixtures

Small binary files the browser under test cannot make itself. Every one was made for this
repository by the project, from drawings and text we wrote; none is copied from anywhere. They are
dedicated to the public domain under CC0-1.0, like the code that made them.

| File | What it is | Used by |
|---|---|---|
| `landscape.heic` | 320 × 240 HEIC, four coloured quarters (red, green, blue, yellow from the top left), with EXIF that holds a GPS position and the camera make `NetworksInsights test` | `heic-to-jpg.spec.ts`, `tools/image/heic-to-jpg/logic.test.ts` |
| `rotated.heic` | The same pixels stored as 320 × 240, with an `irot` box that turns it 90° clockwise for display (EXIF orientation 6 when written), so it shows as 240 × 320 with blue at the top left | `heic-to-jpg.spec.ts`, `logic.test.ts` |
| `ocr-english.png` | "The quick brown fox jumps / over the lazy dog." in Noto Sans, 28 px, black on white | `ocr.spec.ts` |
| `ocr-hindi.png` | "भारत एक बड़ा देश है। / हिंदी भाषा सुंदर है।" in Noto Sans Devanagari, 28 px | `ocr.spec.ts` |

## How they were made (2026-10-04)

HEIC: Pillow 12.3.0 with pillow-heif 1.8.0 (libheif 1.23.4, x265), in a throwaway virtual
environment outside the repository. Nothing of it is a dependency of this project.

```python
from PIL import Image
import pillow_heif
pillow_heif.register_heif_opener()

def quadrants(w, h):
    im = Image.new("RGB", (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w):
            if y < h // 2:
                px[x, y] = (220, 30, 30) if x < w // 2 else (30, 160, 40)
            else:
                px[x, y] = (30, 60, 220) if x < w // 2 else (240, 220, 40)
    return im

def gps_exif(orientation=None):
    exif = Image.Exif()
    exif[0x8825] = {1: "N", 2: (28.0, 36.0, 50.0), 3: "E", 4: (77.0, 12.0, 30.0)}
    exif[0x010F] = "NetworksInsights test"
    if orientation:
        exif[0x0112] = orientation
    return exif

quadrants(320, 240).save("landscape.heic", quality=80, exif=gps_exif().tobytes())
quadrants(320, 240).save("rotated.heic", quality=80, exif=gps_exif(6).tobytes())
```

OCR images: screenshots by Playwright's Chromium of the text above, set in Noto Sans and Noto Sans
Devanagari (SIL Open Font License 1.1, from github.com/notofonts), on a white background at a device
scale factor of 1. The fonts are not in the repository.

PDFs for the OCR tests are written at run time by `support/test-pdf.ts`, and files over a size
limit are made at run time by each spec; none is kept here.
