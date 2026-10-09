import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const TOKEN_IMAGE_DIR = path.join(process.cwd(), "data", "uploads", "token-images");
export const TOKEN_IMAGE_MAX_BYTES = 1_000_000;
export const TOKEN_IMAGE_MIN_DIMENSION = 256;
export const TOKEN_IMAGE_MAX_DIMENSION = 2_048;
export const TOKEN_IMAGE_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/avif"] as const;

export type TokenImageContentType = (typeof TOKEN_IMAGE_ALLOWED_TYPES)[number];

export type StoredTokenImage = {
  key: string;
  url: string;
  contentType: TokenImageContentType;
  bytes: number;
  width: number;
  height: number;
};

export interface TokenImageStore {
  put(args: {
    bytes: Buffer;
    contentType: TokenImageContentType;
    width: number;
    height: number;
  }): Promise<StoredTokenImage>;
  read(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

export class TokenImageStorageConfigError extends Error {
  constructor() {
    super("Direct image uploads are not configured for this production environment.");
    this.name = "TokenImageStorageConfigError";
  }
}

const EXTENSION: Record<TokenImageContentType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
};

const KEY_RE = /^[a-f0-9-]{36}\.(?:png|jpg|webp|avif)$/i;

export function isTokenImageKey(value: string): boolean {
  return KEY_RE.test(value);
}

function localStore(): TokenImageStore {
  return {
    async put({ bytes, contentType, width, height }) {
      await mkdir(TOKEN_IMAGE_DIR, { recursive: true });
      const key = `${randomUUID()}.${EXTENSION[contentType]}`;
      await writeFile(path.join(TOKEN_IMAGE_DIR, key), bytes, { flag: "wx" });
      return {
        key,
        url: `/uploads/token-images/${key}`,
        contentType,
        bytes: bytes.byteLength,
        width,
        height,
      };
    },
    async read(key) {
      if (!isTokenImageKey(key)) return null;
      try {
        return await readFile(path.join(TOKEN_IMAGE_DIR, key));
      } catch {
        return null;
      }
    },
    async delete(key) {
      if (!isTokenImageKey(key)) return;
      await unlink(path.join(TOKEN_IMAGE_DIR, key)).catch(() => undefined);
    },
    publicUrl(key) {
      return `/uploads/token-images/${key}`;
    },
  };
}

/**
 * Local-first selection. A production/serverless process fails closed until a
 * durable adapter is added; callers never mistake ephemeral disk for storage.
 */
export function getTokenImageStore(): TokenImageStore {
  if (process.env.NODE_ENV === "production") throw new TokenImageStorageConfigError();
  return localStore();
}
