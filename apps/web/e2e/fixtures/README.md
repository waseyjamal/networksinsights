# E2E fixtures

Small binary files the browser under test cannot make itself. Every one was made for this
repository by the project, from drawings and text we wrote, except the four AI image fixtures:
those are made from one public-domain photo, named below, because a portrait model needs a real
person. They are dedicated to the public domain under CC0-1.0, like the code that made them.

| File | What it is | Used by |
|---|---|---|
| `landscape.heic` | 320 × 240 HEIC, four coloured quarters (red, green, blue, yellow from the top left), with EXIF that holds a GPS position and the camera make `NetworksInsights test` | `heic-to-jpg.spec.ts`, `tools/image/heic-to-jpg/logic.test.ts` |
| `rotated.heic` | The same pixels stored as 320 × 240, with an `irot` box that turns it 90° clockwise for display (EXIF orientation 6 when written), so it shows as 240 × 320 with blue at the top left | `heic-to-jpg.spec.ts`, `logic.test.ts` |
| `ocr-english.png` | "The quick brown fox jumps / over the lazy dog." in Noto Sans, 28 px, black on white | `ocr.spec.ts` |
| `ocr-hindi.png` | "भारत एक बड़ा देश है। / हिंदी भाषा सुंदर है।" in Noto Sans Devanagari, 28 px | `ocr.spec.ts` |
| `clip-h264-aac.mp4` | 2 s, 320 × 240, 24 fps test pattern, H.264, with a 440 Hz stereo tone in AAC, 48 kHz | `video-to-audio.spec.ts`, `video-compressor.spec.ts`, `video-to-gif.spec.ts` |
| `clip-vp9-opus.webm` | The same 2 s pattern and tone as VP9 and Opus in WebM | the same three specs |
| `long-31s-h264-aac.mp4` | 31 s, 64 × 48, 4 fps test pattern, H.264, with a mono tone in AAC: one second longer than the 30 s GIF limit | `video-to-gif.spec.ts` |
| `long-31s-vp9-opus.webm` | The same 31 s clip as VP9 and Opus | `video-to-gif.spec.ts` |
| `target-h264-aac.mp4` | 8 s, 480 × 270, 24 fps test pattern at 1 Mbit/s, H.264, with a 330 Hz stereo tone in AAC: about 1 MB, so a 0.5 MB target can be tested | `video-compressor.spec.ts` |
| `tone-aac.m4a` | 1 s, 440 Hz stereo tone, AAC in M4A | `audio-converter.spec.ts` |
| `tone-opus.ogg` | 1 s, 440 Hz stereo tone, Opus in Ogg | `audio-converter.spec.ts` |
| `upscale-face.png` | 224 × 96 crop of the face in NASA's portrait of Ellen Ochoa (below), scaled with Lanczos | `image-upscaler.spec.ts` |
| `upscale-face-4x.png` | 896 × 384, the original PyTorch Real-ESRGAN model run on `upscale-face.png` in one piece | `image-upscaler.spec.ts` |
| `portrait.png` | The whole portrait scaled to 512 × 640, the size the MODNet model sees | `background-remover.spec.ts` |
| `portrait-matte.png` | 512 × 640 greyscale, MODNet's matte for `portrait.png` from onnxruntime 1.23.0 | `background-remover.spec.ts` |

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

Video and audio (2026-10-04): FFmpeg's own test sources (`testsrc2`, a moving pattern it draws,
and `sine`), encoded on the owner's machine with FFmpeg N-124300. Only permissive encoders were
used: OpenH264 (BSD-2-Clause) for H.264, libvpx (BSD-3-Clause) for VP9, libopus (BSD-3-Clause) for
Opus and FFmpeg's native AAC encoder. FFmpeg is not a dependency of this project. The WAV files the
audio tests convert are written at run time by `sineWav` in `media.ts`.

```bash
V="testsrc2=size=320x240:rate=24:duration=2"; A="sine=frequency=440:sample_rate=48000:duration=2"
ffmpeg -f lavfi -i "$V" -f lavfi -i "$A" -ac 2 -c:v libopenh264 -b:v 300k -pix_fmt yuv420p -c:a aac -b:a 96k -map_metadata -1 -fflags +bitexact -movflags +faststart clip-h264-aac.mp4
ffmpeg -f lavfi -i "$V" -f lavfi -i "$A" -ac 2 -c:v libvpx-vp9 -b:v 300k -deadline good -pix_fmt yuv420p -c:a libopus -b:a 96k -map_metadata -1 -fflags +bitexact clip-vp9-opus.webm
L="testsrc2=size=64x48:rate=4:duration=31"; LA="sine=frequency=440:sample_rate=48000:duration=31"
ffmpeg -f lavfi -i "$L" -f lavfi -i "$LA" -ac 1 -c:v libopenh264 -b:v 20k -pix_fmt yuv420p -c:a aac -b:a 24k -map_metadata -1 -fflags +bitexact -movflags +faststart long-31s-h264-aac.mp4
ffmpeg -f lavfi -i "$L" -f lavfi -i "$LA" -ac 1 -c:v libvpx-vp9 -b:v 20k -pix_fmt yuv420p -c:a libopus -b:a 24k -map_metadata -1 -fflags +bitexact long-31s-vp9-opus.webm
ffmpeg -f lavfi -i "testsrc2=size=480x270:rate=24:duration=8" -f lavfi -i "sine=frequency=330:sample_rate=48000:duration=8" -ac 2 -c:v libopenh264 -b:v 1000k -pix_fmt yuv420p -c:a aac -b:a 64k -map_metadata -1 -fflags +bitexact -movflags +faststart target-h264-aac.mp4
A1="sine=frequency=440:sample_rate=48000:duration=1"
ffmpeg -f lavfi -i "$A1" -ac 2 -c:a aac -b:a 64k -map_metadata -1 -fflags +bitexact -movflags +faststart tone-aac.m4a
ffmpeg -f lavfi -i "$A1" -ac 2 -c:a libopus -b:a 64k -map_metadata -1 -fflags +bitexact tone-opus.ogg
```

PDFs for the OCR tests are written at run time by `support/test-pdf.ts`, and files over a size
limit are made at run time by each spec; none is kept here.

## The AI image fixtures (2026-10-06)

Source: "Ellen Ochoa.jpg", NASA's official astronaut portrait of Ellen Ochoa, 3256 × 4072,
https://commons.wikimedia.org/wiki/File:Ellen_Ochoa.jpg. Public domain: a work of the US federal
government (NASA). `scripts/models/make-fixtures.py` makes all four files from it and prints the
numbers ADR 0066 bases the test tolerances on.
