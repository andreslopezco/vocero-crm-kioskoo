# Tareas — 031 catálogo Meta

- [x] Especificar objetivo, compatibilidad y límites de stock.
- [x] Modelo aditivo y migración lineal 0021.
- [x] Añadir flag opt-in y endpoints de consulta/sincronización.
- [x] Paginar Meta, validar registros básicos y guardar snapshot atómico.
- [x] Mostrar catálogo y sincronización en Ajustes → WhatsApp.
- [x] Añadir página de consulta del snapshot en el menú, con búsqueda y atributos publicados.
- [x] Crear y editar productos en Meta desde la página del catálogo; resincronizar el snapshot después de guardar.
- [x] Enriquecer el contexto del agente y agregar acción validada de producto.
- [x] Guiar consultas abiertas por categorías reales y pedir un filtro adicional en categorías amplias.
- [x] Enviar producto/lista con el transporte de WhatsApp existente.
- [x] Fallback del agente a resúmenes concisos de nombre/precio en canales sin tarjeta y a resumen más imágenes en WhatsApp si falla el formato nativo.
- [x] Omitir por completo la función del prompt si la flag está apagada.
- [x] Evitar llamadas Meta desde el Laboratorio.
- [x] Pruebas unitarias de bandera, contrato, contexto, prompt condicional y ficha de texto multicanal.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- [x] `pnpm db:generate` confirma que el snapshot Drizzle no tiene deriva.
- [ ] E2E en una instancia conectada a una cuenta/número de prueba de Meta con permiso de lectura de catálogo.
