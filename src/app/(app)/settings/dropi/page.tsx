import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { canConfigure } from "@/lib/auth/roles";
import { dropiOrdersEnabled } from "@/server/dropi/flag";
import { DropiSettingsClient } from "@/components/settings/dropi-client";

export const dynamic = "force-dynamic";

export default async function DropiSettingsPage() {
  if (!dropiOrdersEnabled()) redirect("/settings");
  const session = await requireSession();
  return <DropiSettingsClient canConfigure={canConfigure(session.role)} />;
}
