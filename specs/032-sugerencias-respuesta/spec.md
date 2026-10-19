# 032 — Sugerencias de respuesta para agentes humanos

**Carril**: ligero (Principio VI). Comportamiento nuevo de bandeja, sin cambios
al modelo de datos ni a contratos publicados.

## Problema

Al responder manualmente una conversación, el agente humano no cuenta con una
ayuda para redactar usando el contexto, el conocimiento del negocio y las
instrucciones configuradas. La IA del negocio responde como el personaje del
bot, pero la persona necesita una propuesta redactada como integrante del
equipo que inició sesión.

## Comportamiento y criterios de aceptación

- La bandeja muestra en el compositor de todos los canales un botón para pedir
  una sugerencia de respuesta con IA.
- Al usarlo, la sugerencia considera el historial reciente, el último mensaje
  del cliente, el canal, el conocimiento y las instrucciones del agente, además
  del nombre del usuario autenticado cuando esté disponible.
- La respuesta se escribe como borrador editable en el campo de texto. Nunca
  se envía automáticamente ni se modifica el historial de mensajes.
- El texto se redacta como agente humano del equipo, no como el personaje del
  bot ni como una IA; si falta información, pregunta o indica que se confirmará
  en vez de inventarla.
- La sugerencia usa el proveedor configurado para la organización y respeta el
  aislamiento de conversaciones por organización. Si falta IA o falla el
  proveedor, la persona ve un error recuperable y conserva su texto actual.

## Fuera de alcance

- Envío automático de la sugerencia, cambio del agente configurado o nuevas
  dependencias/proveedores.
- Sugerencias para adjuntos no textuales que el modelo no puede interpretar.
