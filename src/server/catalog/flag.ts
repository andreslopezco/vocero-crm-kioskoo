const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseCatalogFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

export function catalogEnabled(): boolean {
  return parseCatalogFlag(process.env.KIOSKOO_CATALOGO);
}

export function catalogDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
