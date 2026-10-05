// The open-source code that reaches a visitor's browser inside a tool, with its licence and notice.
// The About page shows this list. Keeping a notice is a condition of these licences (ADR 0057):
// never remove an entry while the library is used, and never present the code as ours.

import { LAME_BASE, LAME_SOURCE } from "./lame";
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

/**
 * FreeType's notice under the FreeType License (FTL), which this site chose over the GPLv2 that
 * FreeType also offers (ADR 0062). FTL section 2 requires a binary distribution to state in its
 * documentation that the software is based in part on the work of the FreeType Team; the credit
 * line is the one FTL.TXT recommends, with the year of FreeType 2.14.1.
 */
export const FREETYPE_NOTICE =
  "Portions of this software are copyright © 2025 The FreeType Project (www.freetype.org). All rights reserved. This software is based in part on the work of the FreeType Team. FreeType is used under the FreeType License (FTL), https://freetype.org/license.html.";

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
    name: "wasm-media-encoders (LAME MP3 encoder)",
    version: "0.7.0",
    license: "MIT AND LGPL-2.0-or-later",
    url: "https://github.com/arseneyr/wasm-media-encoders",
    usedFor:
      "Encoding MP3 files in Video to MP3 and Audio to MP3: LAME 3.100 compiled to WebAssembly, with its decoder left out",
    licenseFiles: [`${LAME_BASE}LICENSE.txt`],
    sourceUrls: [
      "https://github.com/arseneyr/wasm-media-encoders/tree/v0.7.0",
      `${LAME_SOURCE.fork}/tree/${LAME_SOURCE.commit}`,
      `${LAME_SOURCE.fork}/blob/${LAME_SOURCE.commit}/COPYING`,
      "https://lame.sourceforge.io/",
    ],
    notice: `This site uses LAME (https://lame.sourceforge.io/), the LAME MP3 encoder, version ${LAME_SOURCE.version}. LAME is free software, distributed under the terms of the GNU Library General Public License, version 2 or (at your option) any later version (LGPL-2.0-or-later); its copyright belongs to the LAME authors. wasm-media-encoders compiles it to WebAssembly, and its own JavaScript is MIT licensed: Copyright (c) 2020-2024 arseneyr. ${MIT_TERMS} This site uses the WebAssembly file unmodified: it is served as it is published, as a separate file at ${LAME_BASE}mp3.wasm, so it can be replaced with another build. The licence text and the complete source code of the exact version used are linked below.`,
  },
  {
    name: "@swc/helpers",
    version: "0.5.23",
    license: "Apache-2.0",
    url: "https://github.com/swc-project/swc",
    usedFor: "Small helper functions inside wasm-media-encoders, in the MP3 tools",
    notice: `Copyright (c) SWC contributors. ${APACHE_TERMS}`,
  },
  {
    name: "fflate",
    version: "0.8.3",
    license: "MIT",
    url: "https://github.com/101arrowz/fflate",
    usedFor: "Reading and writing ZIP files in ZIP create and extract",
    notice: `Copyright (c) 2026 Arjun Barrett. ${MIT_TERMS}`,
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
  {
    name: "yaml",
    version: "2.9.1",
    license: "ISC",
    url: "https://github.com/eemeli/yaml",
    usedFor: "Reading and printing YAML in YAML Formatter",
    notice:
      'Copyright Eemeli Aro <eemeli@gmail.com>. Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.',
  },
  {
    name: "xml-formatter (with xml-parser-xo)",
    version: "3.7.0",
    license: "MIT",
    url: "https://github.com/chrisbottin/xml-formatter",
    usedFor: "Printing XML in XML Formatter, with its parser xml-parser-xo 4.1.6",
    notice: `xml-formatter: Copyright 2019 Chris Bottin (https://github.com/chrisbottin). xml-parser-xo: Copyright 2020 Chris Bottin (https://github.com/chrisbottin). ${MIT_TERMS}`,
  },
  {
    name: "sql-formatter",
    version: "15.9.0",
    license: "MIT",
    url: "https://github.com/sql-formatter-org/sql-formatter",
    usedFor:
      "Formatting SQL in SQL Formatter, with the nearley parser (MIT) and the moo lexer (BSD-3-Clause)",
    notice: `sql-formatter: Copyright (c) 2016-2020 ZeroTurnaround LLC, Copyright (c) 2020-2021 George Leslie-Waksman and other contributors, Copyright (c) 2021-Present inferrinizzard and other contributors. ${MIT_TERMS} nearley: Copyright (c) 2014, 2015, 2016, 2017, 2018, 2019 Kartik Chandra, Tim Radvan, under the same MIT terms. moo: Copyright (c) 2017, Tim Radvan (tjvr) All rights reserved. Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: * Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer. * Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution. * Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
  },
  {
    name: "@embedpdf/pdfium",
    version: "2.15.1",
    license: "MIT",
    url: "https://github.com/embedpdf/embed-pdf-viewer",
    usedFor:
      "Running PDFium in Compress PDF: the WebAssembly build of PDFium and the JavaScript that loads it",
    notice: `Copyright (c) 2024 CloudPDF, Ji Chang. ${MIT_TERMS}`,
  },
  {
    name: "PDFium",
    version: "embedpdf/runtime 0ba3b64",
    license: "BSD-3-Clause AND Apache-2.0",
    url: "https://pdfium.googlesource.com/pdfium/",
    usedFor:
      "Opening PDFs, decoding their pictures and saving the result in Compress PDF, compiled to WebAssembly from the embedpdf/runtime fork",
    sourceUrls: ["https://github.com/embedpdf/runtime"],
    notice: `Copyright 2014 PDFium Authors. All rights reserved. Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution. Neither the name of Google Inc. nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. Parts of PDFium are under the Apache License, Version 2.0. ${APACHE_TERMS}`,
  },
  {
    name: "FreeType",
    version: "2.14.1",
    license: "FTL",
    url: "https://freetype.org/",
    usedFor: "Reading the fonts inside PDFs in Compress PDF, as part of PDFium",
    sourceUrls: ["https://gitlab.freedesktop.org/freetype/freetype"],
    notice: FREETYPE_NOTICE,
  },
  {
    name: "Libraries inside PDFium",
    version: "as pinned by embedpdf/runtime 0ba3b64",
    license: "MIT AND BSD-2-Clause AND IJG AND BSD-3-Clause AND Libpng AND Zlib",
    url: "https://github.com/embedpdf/runtime/tree/0ba3b640128e149f08071e270218560c0991cf73/third_party",
    usedFor:
      "Colour management, JPEG 2000, JPEG, PNG and Deflate decoding and vector drawing inside PDFium's WebAssembly in Compress PDF",
    notice: `Little CMS: Copyright (c) 2023 Marti Maria Saguer, under the MIT licence. OpenJPEG: Copyright (c) 2002-2014, Universite catholique de Louvain (UCL), Belgium, Copyright (c) 2002-2014, Professor Benoit Macq, and the other OpenJPEG contributors, under the 2-clause BSD licence. libjpeg-turbo: This software is based in part on the work of the Independent JPEG Group. Copyright (C)2009-2024 D. R. Commander, Copyright (C)2015 Viktor Szathmáry, under the IJG licence and the 3-clause BSD licence. libpng: Copyright (c) 1995-2019 The PNG Reference Library Authors, Copyright (c) 2018-2019 Cosmin Truta, under the PNG Reference Library License version 2. zlib: Copyright (C) 1995-2022 Jean-loup Gailly and Mark Adler, under the zlib licence. Anti-Grain Geometry 2.3: Copyright (C) 2002-2005 Maxim Shemanarev (McSeem). Permission to copy, use, modify, sell and distribute this software is granted provided this copyright notice appears in all copies. This software is provided "as is" without express or implied warranty, and with no claim as to its suitability for any purpose. The full licence texts are in the source linked here.`,
  },
];
