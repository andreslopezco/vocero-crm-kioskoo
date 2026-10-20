# ADR-003: conector Dropi MCP para órdenes pendientes

**Estado**: Propuesto para staging  
**Fecha**: 2026-10-19

## Contexto

Vocero necesita leer productos y crear una orden en Dropi a partir de una
conversación, dejándola para que una persona la revise y confirme. El MCP oficial
usa OAuth y expone `create_order` como operación mutante. El discovery de OAuth
observado anuncia un authorization server bajo `/bff`, mientras su metadata
declara issuer en el host padre; el cliente MCP oficial rechaza esa discrepancia
en modo estricto. El spike local de e-ntelligence documenta el mismo problema.

## Decisión

- Usar el cliente MCP oficial y conservar validación estricta por defecto.
- Si Dropi no corrige discovery, aceptar solo la discrepancia de issuer ya
  observada mediante una excepción exacta y documentada: resource MCP
  `https://mcp.dropi.co/mcp`, authorization host `oauth.dropi.co`, token/metadata
  host `integrations.dropi.co`, sin redirects a otros orígenes. Nunca desactivar
  validación general ni aceptar endpoints devueltos libremente.
- Aislar tool schemas y credenciales en el adaptador Dropi; persistir tokens
  cifrados con `ENCRYPTION_KEY`; aislar por `organization_id`.
- La creación automática queda apagada por defecto. En staging se habilita solo
  tras comprobar que la nueva orden aparece como `PENDIENTE CONFIRMACION`, sin
  guía/despacho/aviso al comprador; la aplicación no confirma a clientes ni
  cambia estados.
- Los timeouts no se reintentan a ciegas. Se busca por `shop_order_id`; si no
  puede confirmarse el resultado, queda para conciliación humana.

## Consecuencias

- Dropi puede desconectarse o cambiar los schemas del MCP; la degradación es un
  handoff con propuesta guardada, no una confirmación falsa.
- El laboratorio no hace mutaciones reales.
- El cerebro externo configurado por `BRAIN_DISPATCH_URL` necesitaría una
  integración paralela; la acción solo se incluye en el agente integrado al CRM.
- El dueño debe validar el comportamiento real de Dropi en staging antes de
  habilitar `create_order`.
