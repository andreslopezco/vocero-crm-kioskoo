# Plan — Pedidos Dropi desde el agente

## Constitution Check

- I: tokens y OAuth state cifrados AES-GCM; respuestas del MCP validadas con
  Zod; order payload sanitizado; sin secretos en cliente/logs.
- II: adaptador opcional aislado, `DROPI_ORDERS=on` explícito, mock en CI, falla
  a humano y nunca cambia conversaciones si no está conectado.
- III: tablas/consultas org-scoped con unique por organización.
- IV: identificador estable `shop_order_id`, registro durable y reconciliación
  antes de cualquier reintento.
- V: tests unitarios con mock; typecheck, lint, suite y build.
- VI: ciclo completo antes de código (spec, plan, tasks).
- VII: riesgo de creación real y estado inicial documentados; staging exige
  comprobación humana del estado y ausencia de despacho/aviso al cliente.

## Arquitectura

1. Adaptador `src/server/dropi/`: cliente MCP Streamable HTTP, proveedor OAuth
   con hosts de Dropi fijados, storage cifrado y por organización, catálogo
   normalizado, cotización y creación/reconciliación de orden.
2. Configuración opt-in, pantalla Ajustes → Dropi, rutas protegidas Better Auth
   para iniciar/cerrar OAuth y guardar `rate_type`/política de precio. La
   compatibilidad OAuth solo puede saltar la discrepancia de issuer conocida
   manteniendo resource, token/authorize hosts y redirect estrictamente fijados.
3. Tablas aditivas para credencial OAuth/configuración y para intentos de orden
   idempotentes. No se almacena el token en la conversación ni en la ficha.
4. Contexto del agente: consulta acotada de productos cuando la intención trata
   de comprar; datos del contacto/ficha y productos Dropi se entregan como datos
   no confiables. Acción tipada `create_dropi_order` con límites server-side.
5. Caso de uso de orden valida organización, producto activo/stock, variante,
   precio, identidad y domicilio; resuelve ciudad y cotiza envío si corresponde;
   crea una sola vez, verifica estado, anota el resultado, actualiza ficha y
   activa handoff. El mensaje saliente no confirma la orden.
6. `is_test` solo simula un resumen y no llama al MCP. El agente externo de
   `BRAIN_DISPATCH_URL` no ejecuta acciones internas; documentar esa limitación.

## Datos y migraciones

- `dropi_credentials`: configuración org-única, credenciales/token bundle
  cifrado, cliente OAuth, `rate_type`, modo de precio, habilitación de órdenes,
  estado y error sanitizado.
- `dropi_oauth_flow`: state hash, usuario iniciador, estado/verifier cifrados,
  expiración y consumo one-time.
- `dropi_order_submission`: organización/conversación/contacto, clave externa,
  payload normalizado congelado, estado `submitting|submitted|unknown|failed`,
  `provider_order_id`, estado de Dropi y timestamps. Unique por org + clave.
- Migración aditiva generada por Drizzle; cascadas consistentes con la
  eliminación de organización/conversación.

## Riesgos y mitigaciones

- El MCP `create_order` es una mutación real: bandera y switch apagados al
  inicio; staging solo se habilita después de probar el estado inicial en una
  cuenta de desarrollo/controlada.
- El issuer OAuth documentado no coincide con el discovery publicado: el
  cliente mantiene allowlist exacta de hosts y el escape queda apagado por
  defecto, con ADR y test específico.
- `list_orders` puede no indexar el `shop_order_id` inmediatamente: un timeout
  queda `unknown`, no se repite automáticamente y se ofrece conciliación manual.
- Precio `suggested_price` y forma de recaudo afectan el negocio: settings
  explícitos; no hay valores comerciales inventados por el modelo.
- Los sistemas MCP externos pueden cambiar schema: valida schema de entrada y
  respuesta; error visible, sin ejecutar acción de cliente como confirmada.

## Secuencia de implementación

1. ADR de OAuth y contrato normalizado; tipos + mock MCP y pruebas de schemas.
2. Migración + storage cifrado/one-time state + rutas y UI de conexión.
3. Cliente MCP: lectura de producto/ciudad/cotización y mutación/reconciliación.
4. Acción, contexto/prompt y caso de uso con persistencia/idempotencia/handoff.
5. Tests, docs, activar bandera solo en staging; conexión y prueba operativa
   requieren revisión manual del dueño.
