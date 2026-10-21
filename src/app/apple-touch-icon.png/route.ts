import { GET as getAppIcon } from "@/app/api/branding/app-icon/route";

// Safari/iOS suele buscar este nombre estándar al crear «Agregar a inicio».
// Se sirve el mismo PNG dinámico y versionado que usa la configuración de marca.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return getAppIcon(req);
}
