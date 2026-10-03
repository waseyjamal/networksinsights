// Pure logic of "Favicon Generator": the file rules, the square crop, the sizes and names of the
// icons, the .ico container and the HTML tags, with no DOM, no network and no top-level statements
// (docs/tool-contract.md). worker.ts decodes the image and draws each size on an OffscreenCanvas.

export const LIMITS = {
  /** 25 MB, the same as the other image tools. */
  maxInputBytes: 25 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** The largest image read: 50 megapixels, under 200 MB of memory decoded. */
export const MAX_PIXELS = 50_000_000;

/** Every icon made, in the order the page lists them. */
export const ICONS = [
  { size: 16, name: "favicon-16x16.png" },
  { size: 32, name: "favicon-32x32.png" },
  { size: 48, name: "favicon-48x48.png" },
  { size: 180, name: "apple-touch-icon.png" },
  { size: 192, name: "icon-192.png" },
  { size: 512, name: "icon-512.png" },
] as const;

/** The sizes packed into favicon.ico, as PNG images inside the .ico container. */
export const ICO_SIZES = [16, 32, 48] as const;
export const ICO_NAME = "favicon.ico";

export const INPUT_TYPES = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
} as const;

export type ImageType = keyof typeof INPUT_TYPES;

export interface Job {
  image: Blob;
}

export interface OutputFile {
  name: string;
  size: number;
  blob: Blob;
}

export interface JobResult {
  files: OutputFile[];
  width: number;
  height: number;
  cropped: boolean;
}

/** Kept for the manifest's input schema: the tool has no settings. */
export type Input = Record<string, never>;

export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP image.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  unreadable: "This image could not be read. It may be damaged.",
  tooManyPixels: "This image has more than 50 megapixels, more than the browser can hold.",
  failed: "The icons could not be made.",
} as const;

export function imageTypeOf(file: { name: string; type: string }): ImageType | undefined {
  if (file.type in INPUT_TYPES) return file.type as ImageType;
  if (file.type !== "") return;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return;
}

/** The reason a file is refused, or null when it may be used. */
export function checkFile(file: { name: string; type: string; size: number }): string | null {
  if (!imageTypeOf(file)) return MESSAGES.notAnImage;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return null;
}

export function withinPixelLimit(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * height <= MAX_PIXELS;
}

/** The largest centred square inside a picture: a wide picture loses its sides, a tall one its top and bottom. */
export function centreSquare(width: number, height: number) {
  const side = Math.min(width, height);
  return {
    x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) / 2),
    side,
  };
}

/**
 * An .ico file holding PNG images, the layout Windows Vista and every current browser read: a
 * 6-byte header (reserved 0, type 1 for icon, the count), one 16-byte entry per image (width and
 * height, where 0 means 256, colours 0, reserved 0, planes 1, 32 bits per pixel, the byte length
 * and the offset), then the PNG files one after another. Numbers are little endian.
 */
export function buildIco(images: ReadonlyArray<{ size: number; png: Uint8Array }>): Uint8Array {
  const headerBytes = 6 + images.length * 16;
  const total = headerBytes + images.reduce((sum, image) => sum + image.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = headerBytes;
  for (const [index, image] of images.entries()) {
    const entry = 6 + index * 16;
    if (image.size < 1 || image.size > 256)
      throw new RangeError("an .ico image is 1 to 256 pixels");
    view.setUint8(entry, image.size === 256 ? 0 : image.size);
    view.setUint8(entry + 1, image.size === 256 ? 0 : image.size);
    view.setUint8(entry + 2, 0);
    view.setUint8(entry + 3, 0);
    view.setUint16(entry + 4, 1, true);
    view.setUint16(entry + 6, 32, true);
    view.setUint32(entry + 8, image.png.length, true);
    view.setUint32(entry + 12, offset, true);
    out.set(image.png, offset);
    offset += image.png.length;
  }
  return out;
}

/** The width and height written in a PNG's IHDR chunk, or null for bytes that are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** The tags to paste in the head of every page, for files kept at the root of the site. */
export function linkTags(): string {
  return [
    `<link rel="icon" href="/${ICO_NAME}" sizes="48x48">`,
    `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">`,
    `<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">`,
    `<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`,
  ].join("\n");
}

/** The icons entry of a web app manifest, for the 192 and 512 pixel files. */
export function manifestIcons(): string {
  return JSON.stringify(
    {
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    null,
    2,
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
