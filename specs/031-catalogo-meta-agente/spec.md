# Feature Specification: Catálogo de Meta para el agente

**Feature Branch**: `feat/kioskoo-catalogo-meta`
**Created**: 2026-10-18
**Status**: Implementada; typecheck, lint, unitarias, build y generación Drizzle en verde; validación Meta pendiente
**Carril**: Ciclo completo (modelo de datos y nuevo contrato interno del agente).

## Objetivo

Permitir que el agente incluido responda con datos verificables del catálogo
Meta vinculado a la WABA del número conectado y, cuando sea pertinente, envíe
productos por los formatos nativos de WhatsApp. La fuente de catálogo es Meta;
no se permite elegir un catálogo arbitrario ni convertir el CRM en un editor de
inventario.

## Decisiones

- **Feature opt-in**: `KIOSKOO_CATALOGO=on`, apagada por defecto. Sin la bandera,
  endpoints responden 404, la interfaz no ofrece el módulo y el prompt/esquema
  del agente no incluyen acciones de catálogo. La migración aditiva es común a
  todas las instalaciones, siguiendo ADR-001.
- **Descubrimiento**: resolver el catálogo vinculado a la WABA guardada con el
  endpoint de Meta; no confiar en un `catalog_id` enviado por navegador o LLM.
- **Copia local**: guardar un snapshot normalizado por organización, índice de
  catálogo y `product_retailer_id` únicos por organización. Conservar campos
  Meta relevantes sin descartar atributos adicionales. Solo una sincronización
  completa exitosa reemplaza el snapshot publicado.
- **Contexto acotado**: el agente recibe hasta 25 productos en stock por turno,
  ordenados por coincidencia léxica con el mensaje más reciente; el snapshot
  completo se conserva en la base y el servidor valida contra él al enviar.
- **Frescura**: snapshot vigente por 10 minutos. Una consulta explícita permite
  sincronizar manualmente. El agente refresca al inicio del turno si el snapshot
  falta o venció; ante fallo de Meta no usa datos caducados para recomendar ni
  enviar, y responde que debe confirmar disponibilidad. La sincronización se
  coalesce por organización en el proceso, sin cron ni servicio externo.
- **Disponibilidad**: solo `availability = "in stock"` en snapshot vigente es
  vendible. Es el estado publicado por Meta, no una reserva ni garantía contra
  una venta concurrente; el negocio debe mantener el catálogo actualizado.
- **Recomendación**: hasta 25 productos vigentes en stock, seleccionados por
  coincidencia léxica con el mensaje actual, se presentan al LLM como datos no
  confiables. Para enviar, el modelo propone únicamente `product_retailer_id`;
  el servidor resuelve la lista contra el snapshot completo y el `catalog_id`
  vinculado.
- **Envío nativo**: exactamente 1 producto envía `type=product`; 2–30 envían
  `type=interactive`, `interactive.type=product_list`. Solo WhatsApp y dentro
  de la ventana vigente. El Laboratorio persiste una simulación y jamás llama
  Meta. No se crea reserva, carrito ni orden.
- **Compatibilidad**: no se cambian `/api/bot/*` ni despacho 021/025; `/api/health`
  gana el campo aditivo `features.catalogo` para reflejar la bandera. El módulo
  aplica al agente incluido. Fallos de catálogo no detienen turnos ni alteran
  mensajes de texto existentes.

## Historias y criterios de aceptación

### A. Vincular y consultar el catálogo (P1)

- La pantalla de WhatsApp muestra el catálogo vinculado solo con módulo activo.
- El menú principal muestra una página «Catálogo» solo con módulo activo; permite consultar el snapshot sincronizado, buscar productos y revisar sus atributos sin editar ni publicar el inventario.
- Sin catálogo o sin permisos, se informa el motivo sin desconectar WhatsApp.
- Sincronizar trae productos paginados desde Meta; errores y paginación
  incompleta nunca reemplazan el snapshot vigente.
- Productos, atributos, moneda/precio, marca, descripción, disponibilidad,
  imagen, URL e identificador minorista quedan disponibles en el CRM.
- Cada organización solo lee y modifica su snapshot; desconectar WhatsApp
  elimina el snapshot asociado.

### B. Responder sobre productos (P1)

- El prompt recibe productos en stock del snapshot vigente, con datos de Meta
  explícitamente delimitados como fuente de datos y no como instrucciones.
- El agente no inventa campos ausentes, precios o stock. Productos fuera de
  stock nunca se ofrecen como disponibles.
- Snapshot ausente/caducado y fallo de Meta hacen que el agente no recomiende
  ni envíe productos; conserva la posibilidad de responder texto seguro.

### C. Enviar formato nativo (P1)

- Una selección válida envía producto individual; dos o más hasta 30 envían
  lista nativa. Ningún ID/catálogo elegido libremente por el modelo llega a
  Graph sin validación de servidor.
- Ventana cerrada, canal distinto de WhatsApp, ID desconocido, producto fuera
  de stock, módulo apagado o snapshot caducado impiden el envío sin invocar Meta.
- La conversación guarda un registro legible de lo enviado y conserva el
  `wamid`; errores de Meta siguen el tratamiento existente de auth/transitorios.
- Sin flag y para cualquier conversación no-WhatsApp, los flujos originales
  permanecen sin cambios.

## Fuera de alcance

Edición/publicación del catálogo, gestión de inventario, reservas, pago,
checkout, creación de pedidos, búsquedas semánticas/vectoriales, sincronización
cron, envío de carruseles/promociones y soporte a un cerebro externo.
