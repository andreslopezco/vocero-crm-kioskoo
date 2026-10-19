import { WhatsappWizard } from "@/components/settings/whatsapp-wizard";
import { catalogEnabled } from "@/server/catalog/flag";

export const dynamic = "force-dynamic";

export default function WhatsappSettingsPage() {
  return <WhatsappWizard catalogEnabled={catalogEnabled()} />;
}
