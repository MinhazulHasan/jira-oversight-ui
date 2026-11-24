import "server-only";

/** A person's picture as this interface hands it to the browser: the bytes */

export const PICTURE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type PictureType = (typeof PICTURE_TYPES)[number];

/** The most the service keeps of a picture (it stops reading one past this); anything larger is not one of its pictures. */
export const MAX_PICTURE_BYTES = 256 * 1024;

export const NO_PICTURE = "There is no picture of this person on this board.";

const PICTURE_HEADERS = {
  "cache-control": "private, max-age=86400",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
} as const;

/** The media type a Content-Type header names, when it is one of the four; otherwise null. */
export function pictureType(contentType: string | null): PictureType | null {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return PICTURE_TYPES.find((known) => known === type) ?? null;
}

/** Whether the bytes are what their type says, by the signature each format starts with. */
export function isPicture(type: PictureType, bytes: Uint8Array): boolean {
  const at = (offset: number, signature: readonly number[] | string) =>
    [...signature].every((value, index) => bytes[offset + index] === (typeof value === "string" ? value.charCodeAt(0) : value));
  switch (type) {
    case "image/png":
      return at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return at(0, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return at(0, "GIF87a") || at(0, "GIF89a");
    case "image/webp":
      return at(0, "RIFF") && at(8, "WEBP");
  }
}

/** The 200 a picture is served with. */
export function picture(bytes: Uint8Array<ArrayBuffer>, type: PictureType): Response {
  return new Response(bytes, {
    status: 200,
    headers: { ...PICTURE_HEADERS, "content-type": type, "content-length": String(bytes.byteLength) },
  });
}
