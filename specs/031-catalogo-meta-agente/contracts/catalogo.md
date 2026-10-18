# Contrato interno: catálogo y mensajes nativos

## Meta

- El servidor parte de `meta_credentials.waba_id` y usa exclusivamente
  `graphRequest` con su token descifrado en memoria.
- Descubre `/{waba-id}/product_catalogs`, después pagina
  `/{catalog-id}/products` por cursor.
- No se acepta `catalog_id` desde UI/LLM. El payload de envío lo compone el
  servicio desde el vínculo de Meta guardado.
- Una página marcada como siguiente sin cursor, exceso del límite o error Graph
  aborta el reemplazo completo.

## API propia

- `GET /api/settings/catalog` — con flag apagado: 404; encendido: metadatos del
  último snapshot (sin token ni atributos de productos).
- `POST /api/settings/catalog` — sincronización manual del snapshot. Requiere
  sesión autenticada, scoped a organización. Error de acceso/configuración: 422,
  sin conexión: 409, Meta no disponible: 503.
- Flag `KIOSKOO_CATALOGO`; la acción `send_products` solo se añade al esquema
  del agente cuando la feature está encendida y existe snapshot fresco.
- `GET /api/health` añade `features.catalogo`, con el mismo parser de bandera;
  los consumidores existentes deben ignorar campos de `features` que no usen.

## Agente → transporte

```json
{"action":"send_products","retailerIds":["SKU-1","SKU-2"],"reply":"Mira estas opciones"}
```

Zod limita la petición a 1–30 IDs. El servicio resuelve IDs dentro del tenant,
exige snapshot de hasta 10 minutos y `availability === "in stock"`; el cliente
y el LLM no controlan catalog ID, precio, nombre ni estado. Uno se convierte a
`type: product`; varios a `type: interactive` / `interactive.type: product_list`.
El prompt se limita a los 25 productos en stock más relevantes léxicamente para
el último mensaje; la sincronización y validación operan sobre el catálogo
completo.

La acción solo llega a Meta después de la prevalidación existente de destino,
ventana, canal WhatsApp y credenciales. Laboratorio persiste una simulación y
no ejecuta ninguna solicitud Graph.
