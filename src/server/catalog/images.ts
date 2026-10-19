import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

export const CATALOG_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const CATALOG_IMAGE_MAX_COUNT = 10;
export const CATALOG_IMAGE_MIN_DIMENSION = 500;

export class CatalogImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogImageError";
  }
}

export type CatalogImageType = { mimeType: "image/jpeg" | "image/png"; extension: "jpg" | "png"; width: number; height: number };

function jpegSize(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 < data.length) {
    if (data[offset] !== 0xff) return null;
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (marker == null) return null;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) return null;
    const segmentLength = (data[offset]! << 8) | data[offset + 1]!;
    if (segmentLength < 2 || offset + segmentLength > data.length) return null;
    if (frameMarkers.has(marker!)) {
      if (segmentLength < 7) return null;
      const height = (data[offset + 3]! << 8) | data[offset + 4]!;
      const width = (data[offset + 5]! << 8) | data[offset + 6]!;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

export function validateCatalogImage(data: Uint8Array, declaredType: string): CatalogImageType {
  if (data.byteLength === 0 || data.byteLength > CATALOG_IMAGE_MAX_BYTES) {
    throw new CatalogImageError("Cada imagen debe pesar como máximo 8 MB.");
  }
  let result: CatalogImageType | null = null;
  if (declaredType === "image/png" && data.length >= 33 &&
      data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 &&
      data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a &&
      data[12] === 0x49 && data[13] === 0x48 && data[14] === 0x44 && data[15] === 0x52) {
    const width = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(16);
    const height = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(20);
    if (width > 0 && height > 0) result = { mimeType: "image/png", extension: "png", width, height };
  } else if (declaredType === "image/jpeg") {
    const size = jpegSize(data);
    if (size) result = { ...size, mimeType: "image/jpeg", extension: "jpg" };
  }
  if (!result) throw new CatalogImageError("Formato no válido. Sube una imagen JPEG o PNG real.");
  if (result.width < CATALOG_IMAGE_MIN_DIMENSION || result.height < CATALOG_IMAGE_MIN_DIMENSION) {
    throw new CatalogImageError("Meta requiere imágenes de al menos 500 × 500 píxeles.");
  }
  return result;
}

function signature(organizationId: string, assetId: string): Buffer {
  return createHmac("sha256", getEnv().BETTER_AUTH_SECRET)
    .update(`catalog-image:${organizationId}:${assetId}`)
    .digest();
}

export function catalogImageUrl(organizationId: string, assetId: string): string {
  const sig = signature(organizationId, assetId).toString("hex");
  const url = new URL("/api/catalog-images", getEnv().APP_BASE_URL);
  url.searchParams.set("org", organizationId);
  url.searchParams.set("asset", assetId);
  url.searchParams.set("sig", sig);
  return url.toString();
}

export function verifyCatalogImageSignature(organizationId: string, assetId: string, provided: string | null): boolean {
  if (!provided || !/^[a-f0-9]{64}$/i.test(provided)) return false;
  return timingSafeEqual(signature(organizationId, assetId), Buffer.from(provided, "hex"));
}
