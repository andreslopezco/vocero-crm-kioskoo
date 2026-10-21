import { renderPwaIcon } from "@/server/branding/pwa-icon";

export const dynamic = "force-dynamic";

/** Ruta nueva por versión para que Safari no reutilice el Web Clip anterior. */
export async function GET() {
  return renderPwaIcon(180);
}
