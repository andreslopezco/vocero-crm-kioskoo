import { ImageResponse } from "next/og";
import { DEFAULT_BRANDING } from "@/lib/branding";
import {
  BRAND_CYAN_ON_TILE,
  BRAND_MARK_BODY,
  BRAND_MARK_STROKE,
  BRAND_MARK_TAIL,
  isVoceroName,
} from "@/lib/brand";
import { faviconInitial } from "@/lib/favicon";
import { getBranding } from "@/server/branding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(145deg, ${branding.accent}, #083dc0)`,
          borderRadius: 40,
          color: "white",
          fontSize: 116,
          fontWeight: 800,
          letterSpacing: -8,
        }}
      >
        {isVoceroName(branding.name) ? (
          <svg viewBox="0 0 24 24" width="112" height="112">
            <path d={BRAND_MARK_BODY} stroke="white" strokeWidth={BRAND_MARK_STROKE} strokeLinecap="round" fill="none" />
            <path d={BRAND_MARK_TAIL} stroke={BRAND_CYAN_ON_TILE} strokeWidth={BRAND_MARK_STROKE} strokeLinecap="round" fill="none" />
          </svg>
        ) : (
          faviconInitial(branding.name)
        )}
      </div>
    ),
    { ...size }
  );
}
