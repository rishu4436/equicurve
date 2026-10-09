import sharp, { type Metadata } from "sharp";
import { NextResponse } from "next/server";
import { clientKey } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";
import {
  getTokenImageStore,
  TOKEN_IMAGE_ALLOWED_TYPES,
  TOKEN_IMAGE_MAX_BYTES,
  TOKEN_IMAGE_MAX_DIMENSION,
  TOKEN_IMAGE_MIN_DIMENSION,
  TokenImageStorageConfigError,
  type TokenImageContentType,
} from "@/lib/uploads/tokenImageStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MULTIPART_BYTES = TOKEN_IMAGE_MAX_BYTES + 64 * 1024;
const IMAGE_DECODE_SAFETY_DIMENSION = 4_096;
const MIME_TO_FORMAT: Record<TokenImageContentType, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/avif": "avif",
};

function fail(status: number, error: string, code = "invalid_image") {
  return NextResponse.json({ ok: false, error, code }, { status });
}

export async function POST(req: Request) {
  const rl = await limitRequest(clientKey(req, "uploads:token-image"), 10, 10 * 60 * 1000);
  if (!rl.ok) {
    return fail(429, "Too many image upload attempts — slow down.", "rate_limited");
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_MULTIPART_BYTES) {
    return fail(413, "Image upload is too large. Maximum size is 1 MB.", "too_large");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "Could not read the multipart image upload.", "invalid_multipart");
  }
  const files = form.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File)) {
    return fail(400, "Upload exactly one image file.", "one_file_required");
  }
  const file = files[0];
  if (!(TOKEN_IMAGE_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return fail(415, "Unsupported image type. Use PNG, JPEG, WebP or AVIF.", "unsupported_type");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength > TOKEN_IMAGE_MAX_BYTES) {
    return fail(413, "Image is larger than 1 MB. Maximum size is 1 MB.", "too_large");
  }
  if (bytes.byteLength === 0) return fail(400, "The uploaded image is empty.", "empty_image");

  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, {
      limitInputPixels: IMAGE_DECODE_SAFETY_DIMENSION * IMAGE_DECODE_SAFETY_DIMENSION,
      sequentialRead: true,
    }).metadata();
  } catch {
    return fail(422, "The image bytes could not be decoded.", "malformed_image");
  }
  const expectedFormat = MIME_TO_FORMAT[file.type as TokenImageContentType];
  const detectedType = metadata.mediaType ?? (metadata.format === "heif" ? "image/avif" : metadata.format ? `image/${metadata.format}` : "");
  if (!metadata.format || (detectedType !== file.type && metadata.format !== expectedFormat)) {
    return fail(415, "The file type does not match its image bytes.", "mime_mismatch");
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < TOKEN_IMAGE_MIN_DIMENSION || height < TOKEN_IMAGE_MIN_DIMENSION) {
    return fail(422, "Image dimensions must be at least 256 × 256 pixels.", "too_small");
  }
  if (width > TOKEN_IMAGE_MAX_DIMENSION || height > TOKEN_IMAGE_MAX_DIMENSION) {
    return fail(422, "Image dimensions must be at most 2048 × 2048 pixels.", "too_large_dimensions");
  }
  if (width !== height) {
    return fail(422, "Token images must be square.", "not_square");
  }

  try {
    const stored = await getTokenImageStore().put({
      bytes,
      contentType: file.type as TokenImageContentType,
      width,
      height,
    });
    return NextResponse.json({
      ok: true,
      url: stored.url,
      width: stored.width,
      height: stored.height,
      bytes: stored.bytes,
      contentType: stored.contentType,
    });
  } catch (error) {
    if (error instanceof TokenImageStorageConfigError) return fail(503, error.message, "storage_unconfigured");
    return fail(503, "Image storage is unavailable. Try again later.", "storage_unavailable");
  }
}
