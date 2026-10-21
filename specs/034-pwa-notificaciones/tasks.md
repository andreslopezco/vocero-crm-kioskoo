# Tareas — 034 PWA y notificaciones de mensajes

- [x] 1. Modelo y migración
  - [x] 1.1 Definir tabla de suscripciones cifradas por usuario/organización e
        índice único por hash de endpoint.
  - [x] 1.2 Generar migración aditiva y verificar SQL/journal/snapshot.
- [x] 2. Capacidad Web Push opcional
  - [x] 2.1 Añadir bandera y variables VAPID con validación y documentación.
  - [x] 2.2 Implementar adaptador de cifrado, persistencia, envío genérico y
        limpieza 404/410.
  - [x] 2.3 Añadir rutas autenticadas de estado/suscripción/revocación con Zod.
  - [x] 2.4 Conectar solo mensajes entrantes persistidos sin bloquear ingesta.
- [x] 3. PWA
  - [x] 3.1 Añadir manifest e iconos y metadatos instalables.
  - [x] 3.2 Añadir service worker sin caché de contenido privado; manejar push y
        clic a la bandeja con supresión local si una ventana está visible.
  - [x] 3.3 Añadir controles accesibles para instalar, activar push y sonido.
  - [x] 3.4 Añadir sonido en SSE solo para mensajes entrantes, con preferencia
        local y desbloqueo por interacción del usuario.
- [ ] 4. Pruebas y documentación
  - [ ] 4.1 Tests unitarios y E2E de caminos feliz e infeliz (unitarios listos;
        falta prueba end-to-end con sesión y proveedor push configurado).
  - [x] 4.2 Actualizar `.env.example`, documentación de despliegue, versión y
        changelog.
  - [x] 4.3 Ejecutar gates técnicos y self-test de recursos HTTP; falta prueba
        manual de instalación/notificación en dispositivo real.
