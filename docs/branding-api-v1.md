# Branding de empresa

Cada empresa puede registrar un logo privado que será reutilizado posteriormente por los PDF A4 y ticket. La imagen se carga una sola vez y no forma parte del JSON de cada comprobante.

## Consultar branding

```http
GET /v1/admin/tenants/{tenantId}/branding
Authorization: Bearer {PLATFORM_ADMIN_KEY}
```

La respuesta indica si el logo está configurado y devuelve dimensiones, tamaño, hash SHA-256 y versión, sin exponer las claves privadas de R2.

## Cargar o reemplazar logo

```http
PUT /v1/admin/tenants/{tenantId}/branding/logo
Authorization: Bearer {PLATFORM_ADMIN_KEY}
Content-Type: multipart/form-data
```

```bash
curl -X PUT \
  "https://billing-api.nuvex.pe/v1/admin/tenants/{tenantId}/branding/logo" \
  -H "Authorization: Bearer {PLATFORM_ADMIN_KEY}" \
  -F "logo=@/ruta/logo.png"
```

Formatos permitidos: PNG, JPEG y WebP. El tamaño máximo es 5 MB, no se aceptan imágenes animadas ni archivos con más de 20 megapíxeles.

La API elimina metadatos y genera:

- `logo-master.png`: máximo 1600 × 640 px.
- `logo-pdf.png`: máximo 800 × 320 px.
- `logo-preview.webp`: máximo 320 × 128 px.

Todas las variantes mantienen la proporción, no agrandan imágenes pequeñas y se almacenan privadamente bajo `tenants/{tenantId}/branding/logos/{versionId}/...`.

## Snapshot histórico

Al crear una factura, boleta, nota de crédito, nota de débito o GRE, la API copia al documento la versión, clave privada, tamaño, dimensiones y SHA-256 del logo vigente. Ese snapshot es inmutable.

Si la empresa reemplaza el logo, los nuevos comprobantes usan la nueva versión y los anteriores conservan la versión con la que fueron emitidos. Las versiones antiguas no se eliminan de R2 porque pueden ser necesarias para regenerar una representación impresa histórica.

Antes de renderizar, el generador descarga el logo fijado desde R2 y verifica su tamaño y SHA-256. Una diferencia de integridad interrumpe la generación del PDF.

## PDF que utilizan el logo

- Factura: A4 y ticket.
- Boleta: A4 y ticket.
- Nota de crédito: A4 y ticket.
- Nota de débito: A4 y ticket.
- Guía de remisión remitente: A4.

Las empresas que no tengan logo configurado continúan usando el nombre comercial o la razón social como encabezado.
