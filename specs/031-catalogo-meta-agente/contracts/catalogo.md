# Contrato interno: catálogo y mensajes nativos

## Meta

- El servidor parte de `meta_credentials.waba_id` y usa exclusivamente
  `graphRequest` con su token descifrado en memoria.
- Descubre `/{waba-id}/product_catalogs`, después pagina
  `/{catalog-id}/products` por cursor.
- No se acepta `catalog_id` desde UI/LLM. El payload de envío lo compone el
  servicio desde el vínculo de Meta guardado.
- Una página marcada como siguiente sin cursor, exceso del límite o error Graph
  aborta el reemplazo completo.

## API propia

- `GET /api/settings/catalog` — con flag apagado: 404; encendido: metadatos del
  último snapshot (sin token ni atributos de productos).
- `POST /api/settings/catalog` — sincronización manual del snapshot. Requiere
  sesión autenticada, scoped a organización. Error de acceso/configuración: 422,
  sin conexión: 409, Meta no disponible: 503.
- `POST /api/settings/catalog/products` crea un producto y `PUT` al mismo
  endpoint edita un SKU existente. Ambos requieren sesión, flag activa, campos
  validados y un catálogo sincronizado. Catálogo y token salen de la conexión
  guardada por organización, nunca del navegador. Crear desactiva upsert; editar
  solo admite identificadores ya presentes en el snapshot. El precio del editor
  se expresa en unidades mayores y se serializa como número en centésimas para
  la mutación Graph; la moneda se transmite en `currency` por separado.
- `POST /api/settings/catalog/images` recibe un archivo por petición. Valida
  JPEG/PNG real, hasta 8 MB y dimensiones mínimas de 500×500 px; persiste en
  `MEDIA_DIR` y responde una URL HTTPS firmada. `GET /api/catalog-images` solo
  sirve el archivo con firma válida para que los servidores de Meta lo importen.
- El editor limita a 10 fotos por producto, incluida la principal, según la
  capacidad documentada para catálogos de WhatsApp. El API de producto recibe
  URLs públicas y las manda a `image_url` y `additional_image_urls`; Meta no
  recibe un binario multipart por este endpoint. Las copias de origen deben
  conservarse para que Meta pueda reconsultarlas.
- Flag `KIOSKOO_CATALOGO`; el prompt del agente no menciona catálogo cuando la
  flag está apagada. Encendida, describe la función incluso si no hay snapshot;
  la acción `send_products` se añade solo si existe snapshot fresco.
- `GET /api/health` añade `features.catalogo`, con el mismo parser de bandera;
  los consumidores existentes deben ignorar campos de `features` que no usen.

## Agente → transporte

```json
{"action":"send_products","retailerIds":["SKU-1","SKU-2"],"reply":"Mira estas opciones"}
```

Zod limita la petición a 1–30 IDs. El servicio resuelve IDs dentro del tenant,
exige snapshot de hasta 10 minutos y `availability === "in stock"`; el cliente
y el LLM no controlan catalog ID, precio, nombre ni estado. Uno se convierte a
`type: product`; varios a `type: interactive` / `interactive.type: product_list`.
El prompt se limita a los 25 productos en stock más relevantes léxicamente para
el último mensaje; la sincronización y validación operan sobre el catálogo
completo.

En WhatsApp la acción intenta primero el formato nativo, tras la prevalidación
existente de destino, ventana y credenciales. Si falla, se envía una ficha de
texto y luego las imágenes HTTPS presentes en el snapshot. En otros canales no
se intenta tarjeta: se envían únicamente los datos comerciales como texto, sin
exponer URLs de imagen/producto. Laboratorio persiste una simulación y no
ejecuta ninguna solicitud Graph.

La ficha textual y el prompt solo incluyen atributos comerciales en español
(marca, precio, descripción, categoría, condición, material, tamaño, color,
diseño, público, edad, tipo y país de origen). Se excluyen URLs, IDs de feed y
metadatos operativos como estado, inventario, visibilidad, etiquetas y campos
custom numéricos.
