# Contrato: Webhook de WhatsApp Cloud API

Ruta: `/api/webhooks/wa/[webhookToken]` — `[webhookToken]` DEBE igualar
`META_WEBHOOK_VERIFY_TOKEN` (comparación timing-safe). Segmento incorrecto → **404**
sin efectos (GET y POST). Ruta `force-dynamic`.

## GET (handshake de verificación)

Query: `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`.

- `hub.verify_token` == `META_WEBHOOK_VERIFY_TOKEN` y segmento correcto → `200` con
  body = `hub.challenge` (texto plano).
- Cualquier otro caso → `403` (segmento incorrecto → `404`).

## POST (eventos)

1. **Capa 1**: segmento ≠ token → `404` (sin leer el body).
2. **Capa 2** (solo si `META_APP_SECRET` configurado): validar
   `x-hub-signature-256: sha256=<hmac>` = HMAC-SHA256(app_secret, raw body). Inválida o
   ausente → `401`. Sin `META_APP_SECRET` → se omite.
3. Responder `200 {"received":true}` SIEMPRE tras encolar/procesar — nunca 5xx por
   errores de dominio (Meta reintenta y desactiva webhooks que fallan).

### Payload (subset procesado)

```jsonc
{ "object": "whatsapp_business_account",
  "entry": [{ "id": "<WABA_ID>", "changes": [{
    "field": "messages",            // o "message_template_status_update"
    "value": {
      "metadata": { "phone_number_id": "...", "display_phone_number": "..." },
      "contacts": [{ "wa_id": "5215512345678", "profile": { "name": "..." } }],
      "messages": [
        { "id": "wamid-texto", "from": "<IDENTIDAD>",
          "timestamp": "1720000000", "type": "text",
          "text": { "body": "..." } },
        { "id": "wamid-pedido", "from": "<IDENTIDAD>",
          "timestamp": "1720000001", "type": "order",
          "order": {
            "catalog_id": "<CATALOG_ID>",
            "product_items": [{
              "product_retailer_id": "<SKU>", "quantity": "2",
              "item_price": "12500", "currency": "COP"
            }],
            "text": "<NOTA_OPCIONAL>"
          } }
      ],
      "statuses": [{ "id": "wamid....", "status": "sent|delivered|read|failed",
                     "timestamp": "...", "errors": [{ "code": 131047, "title": "..." }] }]
    } }] }] }
```

Reglas de procesamiento:

- Ruteo por `metadata.phone_number_id` → `meta_credentials.phone_number_id` → org. Sin
  match → `200` e ignorar.
- `messages[]` → ingesta idempotente (`wa_message_id` UNIQUE; duplicado → no-op).
  Los tipos no-texto admitidos → mensaje con su tipo correspondiente. `order` se
  valida, guarda estructurado en `message.order_payload` y se muestra como pedido
  con artículos; su resumen legible entra al historial del agente. Los nombres
  se resuelven desde la copia local del catálogo si existe. El pedido recibido
  es una solicitud y no confirma pago. Tipos desconocidos → ignorar sin error.
- `statuses[]` → upgrade monotónico del estado (`sent<delivered<read`; nunca degradar;
  `failed` registra `error_detail`).
- `field: "message_template_status_update"` → `value: { event: "APPROVED"|"REJECTED"|"PENDING",
  message_template_id, message_template_name, message_template_language, reason }` →
  actualizar `template.status` (por nombre+idioma u id), idempotente.
- Tras ingesta: emitir evento SSE y disparar pipeline del agente (si aplica).
