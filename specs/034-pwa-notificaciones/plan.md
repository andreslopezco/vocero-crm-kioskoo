# Plan — 034 PWA y notificaciones de mensajes

## Constitución

- **I Seguridad**: solo mensajes genéricos en push; suscripciones cifradas con
  AES-256-GCM; endpoints autenticados y aislados por usuario/organización.
- **II Soberanía**: Web Push es opcional, detrás de `PUSH_NOTIFICATIONS=on`,
  deshabilitado por defecto; VAPID pertenece al operador; sin bandera el CRM y
  la bandeja funcionan igual. La biblioteca no introduce un SaaS central.
- **IV Idempotencia**: la ingesta ya deduplica el mensaje antes de publicar;
  fallos push no repiten ni revierten efectos del mensaje.
- **V/IX Calidad**: tests unitarios, gates de CI y prueba de navegador; push
  real queda pendiente de interacción humana con un dispositivo autorizado.
- **VI Carril**: ciclo completo por tabla nueva; esta especificación precede al
  diseño e implementación.
- **VII Trazabilidad**: ninguna notificación contendrá PII; sin caché offline.

## Diseño

1. Añadir tabla `push_subscription` con `organization_id`, `user_id`, hash del
   endpoint para unicidad y un único payload cifrado (endpoint, clave pública y
   secreto de autenticación). Crear migración aditiva, sin tocar tablas previas.
2. Añadir bandera opcional `PUSH_NOTIFICATIONS` y configuración VAPID; si faltan
   claves, la capacidad se considera desactivada y los errores son degradables.
3. Crear adaptador `src/server/push/` para guardar/revocar suscripciones y
   enviar el aviso genérico. Al recibir `message.new` entrante ya persistido,
   llamar al adaptador en segundo plano, aislando cualquier error.
4. Crear rutas autenticadas para consultar estado, suscribirse y revocar el
   dispositivo actual. Aplicar validación Zod, rate limit y alcance tenant.
5. Añadir manifest e iconos estáticos, y un service worker de alcance raíz que
   maneja push/clic, sin cachear HTML autenticado, APIs ni media.
6. Añadir una UI global para instalar (incluyendo instrucciones iOS), activar
   notificaciones con gesto explícito y habilitar/silenciar sonido local.
7. El cliente SSE ya es punto único para sonido; ignorar eventos salientes y
   respetar la preferencia guardada. El service worker verifica ventanas
   visibles en su mismo dispositivo antes de mostrar una notificación.

## Riesgos y mitigaciones

- Claves VAPID ausentes o push gateway inalcanzable: función oculta/degradada;
  la ingesta y SSE continúan sin bloquearse.
- Permiso rechazado o navegador sin soporte: mensaje claro y controles
  deshabilitados; la bandeja y el sonido local siguen disponibles.
- La notificación llega a pantalla bloqueada: texto genérico sin PII.
- Retención de suscripciones obsoletas: borrar al recibir 404/410 del gateway.
- El worker puede quedar obsoleto en caché del navegador: URL estable y
  estrategia sin caché de app shell; actualización inmediata y segura.

## Verificación

- Unit tests para flag/config, cifrado/aislamiento, suscripción, push genérico,
  eliminación de endpoint expirado y sonido solo en mensaje entrante.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Playwright: manifest, service worker, control de sonido, permiso denegado y
  fallo de registro; self-test push con gateway simulado.
- Validación humana final en Android y en iPhone agregado a pantalla de inicio:
  el servicio push real depende del SO, permisos y configuración del dispositivo.
