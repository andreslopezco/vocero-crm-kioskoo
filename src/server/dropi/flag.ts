const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function dropiOrdersEnabled(): boolean {
  return ON_VALUES.has((process.env.DROPI_ORDERS ?? "").trim().toLowerCase());
}

export function dropiDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}

export function orderCreationAllowed(): boolean {
  return dropiOrdersEnabled();
}
