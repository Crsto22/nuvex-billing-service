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
