// The open-source code that reaches a visitor's browser inside a tool, with its licence and notice.
// The About page shows this list. Keeping a notice is a condition of these licences (ADR 0057):
// never remove an entry while the library is used, and never present the code as ours.

import { PDFJS_BASE, publishedName } from "./pdfjs";

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
}

const MIT_TERMS =
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.';

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
];
