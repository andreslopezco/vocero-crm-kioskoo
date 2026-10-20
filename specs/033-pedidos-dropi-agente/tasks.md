# Tasks — Pedidos Dropi desde el agente

- [ ] T001 Escribir ADR de límites OAuth, hosts y estado de la orden.
- [ ] T002 Añadir `DROPI_ORDERS` apagada por defecto y doctor/health informativo.
- [ ] T003 Definir tipos normalizados del adaptador Dropi (producto, ciudad,
      cotización, orden) y contratos/mocks.
- [ ] T004 Implementar OAuth MCP de servidor con state/PKCE, hosts fijados,
      tokens cifrados y revocación/desconexión.
- [ ] T005 Añadir tablas Drizzle para conexión, flujo OAuth e idempotencia de
      órdenes; generar migración.
- [ ] T006 Crear APIs Better Auth para conectar, callback, estado, settings,
      desconectar, descubrir tools y operación de lectura.
- [ ] T007 Crear pantalla Ajustes → Dropi con estado, conexión, política de
      precio y rate type; creación real apagada hasta confirmación de prueba.
- [ ] T008 Implementar adaptador MCP para listar/buscar productos, ciudades,
      cotizar, crear orden y consultar para reconciliar.
- [ ] T009 Implementar caso de uso idempotente, límites por organización,
      selección de variaciones, verificación de `PENDIENTE CONFIRMACION`,
      persistencia y reconciliación de timeouts.
- [ ] T010 Agregar `create_dropi_order` al contrato tipado del agente,
      instrucciones/contexto de productos y transición a handoff sin mensaje
      de confirmación.
- [ ] T011 Asegurar que simulación, fallo del MCP y cerebro externo no ejecuten
      ni aparenten crear una orden.
- [ ] T012 Tests unitarios para éxito, datos faltantes, stock/variante/precio
      inválidos, duplicado, timeout ambiguo, estado inesperado y tenant scope.
- [ ] T013 Ejecutar typecheck, lint, tests, build y actualizar documentación.
- [ ] T014 Desplegar staging con creación deshabilitada; validar OAuth y estado
      inicial con operación controlada antes de habilitar creación de órdenes.
