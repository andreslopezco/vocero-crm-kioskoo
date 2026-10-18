# Plan: catálogo Meta para el agente

## Fase 1 — Base aditiva y frontera Meta

- Añadir `meta_catalog` y `meta_catalog_product` con `organization_id NOT NULL`.
- Migración lineal `0021`; sin cambios a tablas/contratos del upstream.
- Resolver catálogo solo desde el WABA cifrado existente y pasar todas las
  solicitudes por `graphRequest`.
- Paginar por cursor, poner límite y publicar snapshot en una transacción; un
  fallo/página incompleta no reemplaza datos utilizables.

## Fase 2 — Superficie opcional

- `KIOSKOO_CATALOGO` apagado por defecto, endpoints 404 cuando está apagado.
- Resumen y botón de sincronización en Ajustes → WhatsApp.
- El agente incorporado carga snapshot fresco al turno; sandbox lee solo un
  snapshot existente y jamás inicia llamadas a Meta.
- Datos de catálogo delimitados como datos no confiables; disponibles solo los
  productos cuyo estado publicado sea `in stock`, con selección léxica top-25
  para evitar desbordar el contexto del proveedor.

## Fase 3 — Acción de producto

- El esquema habilita `send_products` solo si hay snapshot fresco y el canal es
  WhatsApp.
- El servidor vuelve a resolver todos los IDs contra la copia vigente y
  construye `catalog_id` en servidor.
- 1 elemento: mensaje `product`; 2–30: `interactive.product_list`.
- Reutilizar `prepareSend`, `callGraphSend` y persistencia existentes.

## Verificación

- Unitarias: flag, esquema opt-in y exclusión de agotados en contexto.
- Contrato/E2E pendientes de ejecutar localmente: sincronización de Meta mock,
  snapshot transaccional, validación de stock/IDs, productos/listas, sandbox,
  ventana cerrada, flag apagado y canales no WhatsApp.
- Ejecutar `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, y los guiones
  E2E del repo tras restaurar dependencias.

## Riesgos y mitigaciones

- El token debe tener acceso de lectura a catálogos; si Meta lo rechaza,
  Ajustes muestra error sin desconectar el número ni usar snapshot caducado.
- Meta publica disponibilidad, no una reserva. El CRM no afirma stock vigente
  luego de 10 minutos ni intenta prometer apartados.
- La selección léxica puede omitir una coincidencia semántica indirecta; en ese
  caso el agente pregunta para aclarar, nunca inventa ni envía IDs no resueltos.
- `product_list` y `product` dependen de aprobación/capacidades de WhatsApp del
  negocio. Los errores Graph siguen el mapeo de `callGraphSend`.
