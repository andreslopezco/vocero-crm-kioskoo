# 034 — PWA y notificaciones de mensajes

**Carril**: ciclo completo (Principio VI): la suscripción push se guarda en
PostgreSQL, vinculada al usuario y organización, y cifrada en reposo.

## Problema

El equipo no se entera cuando entra un mensaje si no está mirando la bandeja.
En móvil, además, abrir Vocero como una pestaña del navegador no ofrece una
experiencia de aplicación instalable. Cuando la bandeja sí está abierta, los
mensajes nuevos no tienen una señal sonora.

## Comportamiento y criterios de aceptación

- Vocero puede instalarse desde navegadores compatibles y abrir en modo
  independiente, con nombre e iconos propios; no almacena en caché pantallas
  autenticadas, APIs ni datos de clientes para uso sin conexión.
- La bandeja ofrece un control para activar notificaciones del dispositivo. El
  permiso se solicita solo tras una acción explícita del usuario. En iOS, la
  interfaz explica que primero debe agregarse Vocero a la pantalla de inicio.
- Con `PUSH_NOTIFICATIONS=on` y VAPID configurado, cada navegador autorizado
  recibe avisos de mensajes entrantes mientras la app está cerrada o en segundo
  plano. El aviso no contiene nombres, teléfonos ni texto de clientes y al
  tocarlo abre la bandeja.
- Las suscripciones pertenecen al usuario y organización autenticados, se
  cifran con `ENCRYPTION_KEY`, pueden revocarse y una expiración/remoción del
  proveedor no interrumpe la ingesta del mensaje.
- Sin la bandera o las claves, Vocero sigue funcionando como CRM; la superficie
  push no se expone y ningún envío a proveedores de push ocurre.
- Con la bandeja abierta, se puede activar o silenciar un sonido breve para
  mensajes entrantes. Los mensajes propios, estados de entrega y eventos de
  reconexión no emiten sonido. La preferencia se conserva en el dispositivo.
- Si una app ya está visible en ese mismo dispositivo, el service worker evita
  una notificación de sistema duplicada; otros dispositivos suscritos siguen
  pudiendo recibirla.
- El registro y eliminación de suscripciones requieren sesión y nunca permiten
  actuar sobre otro usuario u organización.

## Decisiones y fuera de alcance

- El push usa Web Push estándar con claves VAPID propias de la instalación y la
  biblioteca `web-push`; los navegadores enrutan el aviso por su servicio push.
  Es un conector opcional tras `PUSH_NOTIFICATIONS`, apagado por defecto, sin
  dependencia de un proveedor SaaS central de Vocero.
- Se usan notificaciones genéricas para proteger información comercial en la
  pantalla bloqueada. No se hace broadcast ni notificación de pedidos/citas.
- No se ofrece modo offline de conversaciones: cachear datos autenticados
  pondría información sensible en almacenamiento local del dispositivo.
- El sonido solo aplica mientras una sesión web está abierta; el sonido del
  aviso del sistema lo controla el sistema operativo y el usuario.
