import { redirect } from "next/navigation";
import { dropiOrdersEnabled } from "@/server/dropi/flag";
import { OrdersClient } from "@/components/orders/orders-client";

export const dynamic = "force-dynamic";

export default function OrdersPage() {
  if (!dropiOrdersEnabled()) redirect("/inbox");
  return <OrdersClient />;
}
