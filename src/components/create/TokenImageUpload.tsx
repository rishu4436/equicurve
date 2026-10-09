"use client";

import { useRef, useState } from "react";
import { isLocalTokenImageUrl, normalizeHttpsUrl } from "@/lib/validation";

const ACCEPTED = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);
const MAX_BYTES = 1_000_000;
const MIN_DIMENSION = 256;
const MAX_DIMENSION = 2_048;

export type ImageUploadState = "idle" | "uploading" | "valid" | "invalid" | "failed";

function inspectDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The image could not be decoded by the browser."));
    };
    image.src = url;
  });
}

function validateFile(file: File): Promise<string | null> {
  if (!ACCEPTED.has(file.type)) return Promise.resolve("Unsupported image type. Use PNG, JPEG, WebP or AVIF.");
  if (file.size > MAX_BYTES) return Promise.resolve("Image is larger than 1 MB. Maximum size is 1 MB.");
  if (file.size === 0) return Promise.resolve("The selected image is empty.");
  return inspectDimensions(file).then(({ width, height }) => {
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) return "Image dimensions must be at least 256 × 256 pixels.";
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) return "Image dimensions must be at most 2048 × 2048 pixels.";
    if (width !== height) return "Token images must be square.";
    return null;
  }).catch((error) => error instanceof Error ? error.message : "The image could not be decoded by the browser.");
}

export function TokenImageUpload({
  value,
  onChange,
  onStatusChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onStatusChange?: (state: ImageUploadState, error?: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ImageUploadState>(value ? "valid" : "idle");
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const safeValue = value && (isLocalTokenImageUrl(value) || normalizeHttpsUrl(value)) ? value : "";

  function setUploadState(next: ImageUploadState, error?: string) {
    setState(next);
    setMessage(error ?? null);
    onStatusChange?.(next, error);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    const validationError = await validateFile(file);
    if (validationError) {
      onChange("");
      setUploadState("invalid", validationError);
      return;
    }
    setUploadState("uploading");
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const response = await fetch("/api/uploads/token-image", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
      if (!response.ok || !body.ok || !body.url) throw new Error(body.error || `Upload failed (HTTP ${response.status})`);
      onChange(body.url);
      setUploadState("valid", "Image uploaded and validated.");
    } catch (error) {
      onChange("");
      setUploadState("failed", error instanceof Error ? error.message : "Image upload failed.");
    }
  }

  function clear() {
    onChange("");
    setUploadState("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-2" data-testid="token-image-upload">
      <span className="ec-label">Project image (optional)</span>
      <div
        className={`rounded-card border border-dashed p-4 transition-colors ${dragging ? "border-accent bg-accent/10" : "border-line bg-subtle/40"}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files[0]); }}
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-card border border-line bg-base text-xs text-fg-muted">
            {safeValue ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={safeValue} alt="Project image preview" className="h-full w-full object-cover" onError={() => setMessage("The uploaded image could not be previewed.")} />
            ) : "No image"}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm text-fg-secondary">Drop a square image here or choose one from your device.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="ec-btn-secondary" onClick={() => inputRef.current?.click()} disabled={state === "uploading"}>
                {state === "uploading" ? "Uploading…" : "Choose image"}
              </button>
              {safeValue && <button type="button" className="ec-btn-secondary" onClick={clear}>Remove</button>}
            </div>
            <p className="text-xs text-fg-muted">PNG, JPEG, WebP or AVIF · square · 256–2048 px · maximum 1 MB</p>
          </div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        className="sr-only"
        onChange={(event) => { void upload(event.target.files?.[0]); }}
        data-testid="token-image-file"
      />
      <p className={`text-xs ${state === "valid" ? "text-signal-grad" : state === "invalid" || state === "failed" ? "text-signal-danger" : "text-fg-muted"}`} role={state === "invalid" || state === "failed" ? "alert" : undefined}>
        {message ?? (state === "idle" ? "Image is optional. EquiCurve validates the file before accepting it." : state === "valid" ? "Image uploaded and validated." : "")}
      </p>
    </div>
  );
}
