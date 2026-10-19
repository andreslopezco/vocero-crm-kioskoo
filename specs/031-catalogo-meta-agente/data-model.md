# Modelo de datos — 031 catálogo Meta

## `meta_catalog`

Una fila por organización. `catalog_id` se descubre desde la WABA; no lo elige
el usuario ni el modelo. `synced_at` es la hora de la última publicación
completa exitosa. Un fallo no cambia este marcador ni el snapshot anterior.

| Campo | Tipo | Regla |
|---|---|---|
| `id` | text PK | ID interno |
| `organization_id` | text FK | NOT NULL, cascade, único |
| `catalog_id` | text | ID externo de Meta |
| `catalog_name` | text nullable | Presentación solamente |
| `synced_at` | timestamp nullable | Frescura del snapshot |
| `created_at`, `updated_at` | timestamp | UTC |

## `meta_catalog_product`

Snapshot completo de productos. `organization_id` tiene FK a organización y
todas las lecturas/escrituras van por `scoped()`. `retailer_id` es la clave que
WhatsApp espera al mandar un producto; único dentro de la organización.

| Campo | Tipo | Uso |
|---|---|---|
| IDs y tenant | text | Identidad + aislamiento |
| `catalog_id`, `retailer_id`, `name` | text | Catálogo Meta, clave comercial, nombre |
| `description`, `availability`, `price`, `currency`, `brand` | text nullable | Datos tipados de Meta |
| `image_url`, `url` | text nullable | Recursos del producto |
| `attributes` | jsonb NOT NULL | Campos Meta adicionales, se conservan sin reinterpretarlos |
| timestamps | timestamp | Auditoría |

Sin guardar tokens ni datos de clientes. Al desconectar/reemplazar la WABA se
elimina el snapshot; al borrar la organización se elimina en cascada.
