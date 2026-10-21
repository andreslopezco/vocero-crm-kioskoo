import { renderPwaIcon } from "@/server/branding/pwa-icon";

export const dynamic = "force-dynamic";

export async function GET() {
  return renderPwaIcon(192);
}
