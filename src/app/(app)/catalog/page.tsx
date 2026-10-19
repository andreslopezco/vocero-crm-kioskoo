import { notFound } from "next/navigation";
import { catalogEnabled } from "@/server/catalog/flag";
import { CatalogPage } from "@/components/catalog/catalog-page";

export const dynamic = "force-dynamic";

export default function CatalogRoute() {
  if (!catalogEnabled()) notFound();
  return <CatalogPage />;
}
