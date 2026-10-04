// The open-source code that reaches a visitor's browser inside a tool, with its licence and notice.
// The About page shows this list. Keeping a notice is a condition of these licences (ADR 0057):
// never remove an entry while the library is used, and never present the code as ours.

import { LIBHEIF_BASE } from "./libheif";
import { PDFJS_BASE, publishedName } from "./pdfjs";
import { TESSERACT_BASE } from "./tesseract";

export interface Credit {
  /** The package as a developer finds it. */
  name: string;
  version: string;
  /** SPDX expression. */
  license: string;
  /** Where the source lives. */
  url: string;
  /** What it does on this site, in a few words. */
  usedFor: string;
  /** The copyright and licence notice, as the package ships it. */
  notice: string;
  /** Licence files served word for word next to files the site copies from the package. */
  licenseFiles?: readonly string[];
  /** Where to get the source code, for a licence that requires it to be offered (LGPL). */
  sourceUrls?: readonly string[];
}

const APACHE_TERMS =
  'Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0. Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.';

const MIT_TERMS =
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.';

/** libFLAC's licence, COPYING.Xiph in xiph/flac at the commit the FLAC encoder was built from. */
export const LIBFLAC_NOTICE =
  "Copyright (C) 2000-2009 Josh Coalson. Copyright (C) 2011-2025 Xiph.Org Foundation. Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: - Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer. - Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution. - Neither the name of the Xiph.Org Foundation nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE FOUNDATION OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.";

/** The zlib licence notice inside pako 1.0.11 (`lib/zlib/*.js`), word for word. */
export const ZLIB_NOTICE =
  "(C) 1995-2013 Jean-loup Gailly and Mark Adler. (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin. This software is provided 'as-is', without any express or implied warranty. In no event will the authors be held liable for any damages arising from the use of this software. Permission is granted to anyone to use this software for any purpose, including commercial applications, and to alter it and redistribute it freely, subject to the following restrictions: 1. The origin of this software must not be misrepresented; you must not claim that you wrote the original software. If you use this software in a product, an acknowledgment in the product documentation would be appreciated but is not required. 2. Altered source versions must be plainly marked as such, and must not be misrepresented as being the original software. 3. This notice may not be removed or altered from any source distribution.";

export const credits: readonly Credit[] = [
  {
    name: "pdf-lib",
    version: "1.17.1",
    license: "MIT",
    url: "https://github.com/Hopding/pdf-lib",
    usedFor: "Writing PDF files in the PDF tools",
    notice: `Copyright (c) 2019 Andrew Dillon. ${MIT_TERMS}`,
  },
  {
    name: "pako",
    version: "1.0.11",
    license: "(MIT AND Zlib)",
    url: "https://github.com/nodeca/pako",
    usedFor: "Compressing data inside PDF files, as part of pdf-lib",
    notice: `Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn. ${MIT_TERMS} The zlib port in pako: ${ZLIB_NOTICE}`,
  },
  {
    name: "PDF.js (pdfjs-dist)",
    version: "6.3.289",
    license: "Apache-2.0",
    url: "https://github.com/mozilla/pdf.js",
    usedFor:
      "Drawing PDF pages as images in PDF to JPG, with the image decoders (OpenJPEG, PDFium JBIG2, qcms), fonts (Foxit, Liberation), CMaps (Adobe) and colour profile it ships",
    licenseFiles: [
      "wasm/LICENSE_OPENJPEG",
      "wasm/LICENSE_PDFJS_OPENJPEG",
      "wasm/LICENSE_JBIG2",
      "wasm/LICENSE_PDFJS_JBIG2",
      "wasm/LICENSE_QCMS",
      "wasm/LICENSE_PDFJS_QCMS",
      "standard_fonts/LICENSE_FOXIT",
      "standard_fonts/LICENSE_LIBERATION",
      "cmaps/LICENSE",
      "iccs/LICENSE",
    ].map((file) => `${PDFJS_BASE}${publishedName(file)}`),
    notice:
      'Copyright 2024 Mozilla Foundation. Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0. Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.',
  },
  {
    name: "libheif-js (libheif and libde265)",
    version: "1.23.2",
    license: "LGPL-3.0",
    url: "https://github.com/catdad-experiments/libheif-js",
    usedFor:
      "Decoding HEIC and HEIF photos in HEIC to JPG: libheif reads the file and libde265 decodes the HEVC pictures, compiled to WebAssembly",
    licenseFiles: [`${LIBHEIF_BASE}LICENSE.txt`],
    sourceUrls: [
      "https://github.com/catdad-experiments/libheif-js",
      "https://github.com/catdad-experiments/libheif-emscripten",
      "https://github.com/strukturag/libheif",
      "https://github.com/strukturag/libde265",
    ],
    notice: `libheif: Copyright (c) 2017-2020 Struktur AG, Copyright (c) 2017-2026 Dirk Farin. libde265: Copyright (c) 2013-2014 Struktur AG. Both are free software, distributed under the terms of the GNU Lesser General Public License, version 3 (LGPL-3.0); libheif-js packages them for the browser under the same licence. This site uses them unmodified: the WebAssembly file is served as it is published, as a separate file at ${LIBHEIF_BASE}libheif.wasm, so it can be replaced with another build. The licence text is linked below, and the complete source code is available from the projects linked here.`,
  },
  {
    name: "tesseract.js",
    version: "7.0.0",
    license: "Apache-2.0",
    url: "https://github.com/naptha/tesseract.js",
    usedFor: "Running the OCR engine in OCR image to text",
    licenseFiles: [`${TESSERACT_BASE}LICENSE-tesseract.js.txt`],
    notice: `Copyright (c) Project Naptha and the tesseract.js contributors. ${APACHE_TERMS}`,
  },
  {
    name: "tesseract.js-core (Tesseract OCR)",
    version: "7.0.0",
    license: "Apache-2.0",
    url: "https://github.com/naptha/tesseract.js-core",
    usedFor:
      "Reading text in OCR image to text: the Tesseract OCR engine (with Leptonica) compiled to WebAssembly",
    licenseFiles: [`${TESSERACT_BASE}LICENSE-tesseract.js-core.txt`],
    notice: `Tesseract OCR: Copyright (c) Google and the Tesseract contributors, https://github.com/tesseract-ocr/tesseract. ${APACHE_TERMS}`,
  },
  {
    name: "Tesseract language data (tessdata_best, English and Hindi)",
    version: "4.0.0",
    license: "Apache-2.0",
    url: "https://github.com/tesseract-ocr/tessdata_best",
    usedFor:
      "The trained English and Hindi models OCR image to text reads with, in the integer versions packaged as @tesseract.js-data/eng and @tesseract.js-data/hin 1.0.0",
    notice: `Copyright (c) Google and the Tesseract contributors. ${APACHE_TERMS}`,
  },
  {
    name: "Mediabunny",
    version: "1.61.0",
    license: "MPL-2.0",
    url: "https://github.com/Vanilagy/mediabunny",
    usedFor:
      "Reading and writing MP4, WebM, WAV, FLAC and OGG files in Video compressor, Video to audio, Audio converter and Video to GIF, with the browser's own WebCodecs encoders and decoders",
    sourceUrls: ["https://github.com/Vanilagy/mediabunny/tree/v1.61.0"],
    notice:
      "Copyright (c) 2026-present, Vanilagy and contributors. This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/. This site uses the published package unmodified; its source code is available at the link here.",
  },
  {
    name: "@mediabunny/flac-encoder (libFLAC)",
    version: "1.61.0",
    license: "MPL-2.0 AND BSD-3-Clause",
    url: "https://github.com/Vanilagy/mediabunny/tree/main/packages/flac-encoder",
    usedFor:
      "Writing FLAC files in Audio converter: the libFLAC encoder from Xiph.Org, compiled to WebAssembly without Ogg or any other library, run by Mediabunny",
    sourceUrls: [
      "https://github.com/Vanilagy/mediabunny/tree/v1.61.0/packages/flac-encoder",
      "https://github.com/xiph/flac",
    ],
    notice: `The encoder package: Copyright (c) 2026-present, Vanilagy and contributors, under the Mozilla Public License, v. 2.0 (https://mozilla.org/MPL/2.0/). libFLAC inside it: ${LIBFLAC_NOTICE} The JavaScript that loads the WebAssembly is generated by Emscripten, under the MIT licence.`,
  },
  {
    name: "gifenc",
    version: "1.0.3",
    license: "MIT",
    url: "https://github.com/mattdesl/gifenc",
    usedFor: "Choosing the colours of each frame and writing the GIF in Video to GIF",
    notice: `Copyright (c) 2017 Matt DesLauriers. ${MIT_TERMS}`,
  },
];
