import { renderPwaIcon } from "@/server/branding/pwa-icon";

// Safari/iOS busca este nombre canónico al crear «Agregar a inicio».
export const dynamic = "force-dynamic";
export async function GET() {
  return renderPwaIcon(180);
}
