# Pedidos Dropi desde el agente

**Feature Branch**: `feat/pedidos-dropi-agente`
**Created**: 2026-10-19
**Status**: En implementación
**Carril**: Ciclo completo (integración OAuth, persistencia, acciones del agente)

## Objetivo

Cuando un cliente manifieste intención clara de compra, el agente reúne los
datos necesarios, crea una orden en Dropi para revisión humana y transfiere la
conversación. La orden debe quedar en `PENDIENTE CONFIRMACION`; Vocero nunca la
presenta al cliente como confirmada ni confirma disponibilidad.

## Decisiones

- Conector opcional `DROPI_ORDERS=on`, apagado por defecto, con credenciales
  OAuth cifradas por organización y adaptador MCP server-side. El Laboratorio
  no crea órdenes reales.
- Dropi es la fuente de productos, IDs, variantes, precio disponible e
  información de envío; el catálogo Meta no participa en la creación.
- El agente puede preparar la orden solo con los campos requeridos y validados
  por el servidor. `rate_type` y la política de precio se configuran en Ajustes;
  si falta la configuración o un dato, el agente pregunta y no crea.
- Antes de habilitar la creación, el propietario prueba en staging que el
  `create_order` de su cuenta genera `PENDIENTE CONFIRMACION` sin despachar,
  generar guía ni notificar al comprador. Hasta entonces, las operaciones
  disponibles son de lectura/cotización y la acción de crear permanece
  deshabilitada por un switch explícito.
- La creación es una acción de una sola ejecución con clave local estable por
  conversación/orden. Ante timeout no se repite a ciegas: se busca por
  `shop_order_id`/teléfono y se registra el resultado ambiguo para revisión.
- Una creación exitosa persiste el ID y resumen de Dropi, guarda los datos
  recogidos en la ficha, transfiere la conversación a una persona y no envía
  mensaje de confirmación del pedido. El mensaje de traspaso solo informa que
  el equipo revisará la información.
- Si Dropi no devuelve el estado esperado, la orden queda marcada como
  `requiere_revision`; Vocero omite confirmación al cliente y avisa al equipo.
- Los fallos de Dropi no pierden la conversación ni duplican una orden: se
  deriva a humano con la propuesta en la ficha.

## Criterios de aceptación

- Sin bandera, conexión y acciones Dropi, la instancia se comporta exactamente
  como antes y no muestra el conector.
- Ajustes permite conectar/desconectar la cuenta de Dropi y configurar tasa de
  recaudo y política de precio sin exponer tokens.
- El prompt solo recibe productos/variantes validados del MCP, con stock y
  precio disponibles; nunca inventa IDs, precio, stock o ciudad.
- La intención de compra sin datos completos genera preguntas; no llama a
  `create_order`.
- Una orden válida se crea máximo una vez, con datos del contacto y
  `shop_order_id` estable; se verifica `PENDIENTE CONFIRMACION` antes de tratar
  el resultado como listo para revisión.
- Éxito implica ficha actualizada, handoff activo y mensaje sin promesa de
  confirmación/disponibilidad.
- Timeout, error o estado no esperado no causan reintento ciego, no confirman al
  cliente y dejan una indicación clara para revisión manual.
- Las conversaciones `is_test` nunca llaman Dropi.

## Fuera de alcance

Confirmar órdenes, generar guías, cambiar estados, editar/cancelar órdenes ya
creadas desde Vocero, sincronizar todo el historial, y habilitar creación
automática antes de validar el comportamiento pendiente del MCP en staging.
