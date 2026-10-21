import type { MetadataRoute } from "next";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { getBranding } from "@/server/branding";

export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  return {
    id: "/",
    name: branding.name,
    short_name: branding.name.slice(0, 20),
    description: `${branding.name} · CRM de conversaciones`,
    lang: "es",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#f6f8fc",
    // La barra superior es azul marino fijo incluso cuando cambia el acento
    // white-label, así que el navegador instalado debe usar el mismo tono.
    theme_color: "#070e20",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
