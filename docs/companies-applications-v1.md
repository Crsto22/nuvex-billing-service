# Empresas y aplicaciones v1

## Conceptos

- **Empresa (`tenant`)**: contribuyente identificado por RUC. Es la frontera principal de aislamiento.
- **Aplicación**: sistema autorizado a operar para una empresa, por ejemplo Nuvex o un POS externo.
- **API key**: credencial de una aplicación para un ambiente. Las keys BETA comienzan con `nb_test_` y las de producción con `nb_live_`.

## Administración

Las rutas `/v1/admin/*` requieren:

```http
Authorization: Bearer <PLATFORM_ADMIN_KEY>
```

Endpoints:

```text
POST   /v1/admin/tenants
GET    /v1/admin/tenants
GET    /v1/admin/tenants/{tenantId}
PATCH  /v1/admin/tenants/{tenantId}/status

POST   /v1/admin/tenants/{tenantId}/applications
GET    /v1/admin/tenants/{tenantId}/applications
PATCH  /v1/admin/applications/{applicationId}/status

POST   /v1/admin/applications/{applicationId}/api-keys
GET    /v1/admin/applications/{applicationId}/api-keys
DELETE /v1/admin/api-keys/{apiKeyId}
```

La API key completa se devuelve únicamente al crearla. Los listados muestran solo su prefijo y metadatos.

## Uso desde una aplicación

```http
Authorization: Bearer nb_test_<prefix>.<secret>
```

`GET /v1/me` devuelve el contexto autenticado:

```json
{
  "type": "API_KEY",
  "apiKeyId": "...",
  "applicationId": "...",
  "tenantId": "...",
  "environment": "BETA",
  "scopes": ["documents:read", "documents:write"]
}
```

## Reglas de seguridad

- Las API keys se almacenan como HMAC-SHA-256; nunca en texto recuperable.
- Una key revocada o vencida deja de funcionar inmediatamente.
- Suspender una empresa invalida todas sus aplicaciones y keys.
- Deshabilitar una aplicación invalida todas sus keys.
- El prefijo `test/live` debe coincidir con el ambiente persistido.
- Los cambios administrativos generan registros de auditoría sin secretos.
- Las rutas quedan protegidas por defecto; solo `GET /v1/health` es pública.

## Desarrollo local

Con Docker disponible:

```bash
docker compose up -d postgres
copy .env.example .env
npm run db:migrate:deploy
npm run start:api:dev
```

En `.env` deben reemplazarse todos los valores `REPLACE_*` por secretos reales de desarrollo.
