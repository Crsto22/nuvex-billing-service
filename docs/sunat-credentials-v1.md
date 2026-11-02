# Credenciales SUNAT v1

Cada empresa tiene una configuraciÃ³n independiente para `BETA` y otra para `PRODUCTION`. Contiene usuario y clave SOL, credenciales OAuth opcionales para integraciones futuras y un certificado PKCS#12 (`.pfx` o `.p12`).

## Endpoints administrativos

Todas las rutas requieren `Authorization: Bearer <PLATFORM_ADMIN_KEY>`.

```text
GET    /v1/admin/tenants/{tenantId}/sunat-credentials
GET    /v1/admin/tenants/{tenantId}/sunat-credentials/{environment}
PUT    /v1/admin/tenants/{tenantId}/sunat-credentials/{environment}
PUT    /v1/admin/tenants/{tenantId}/sunat-credentials/{environment}/certificate
DELETE /v1/admin/tenants/{tenantId}/sunat-credentials/{environment}/certificate
```

El certificado se carga como `multipart/form-data`, con el archivo en `certificate` y su contraseÃ±a en `password`. El lÃ­mite es 2 MB.

## Controles

- Los secretos se cifran con AES-256-GCM y contexto por empresa, ambiente y campo.
- El PFX/P12 se abre antes de guardarlo y se comprueba que incluya una clave privada correspondiente al certificado.
- Se guardan huella SHA-256, serie, sujeto, emisor y fechas de vigencia.
- El archivo vive en un bucket S3/R2 privado; la base conserva solamente su clave interna.
- Ninguna respuesta devuelve usuario SOL, contraseÃ±as, OAuth ni la clave del objeto privado.
- No se puede activar una configuraciÃ³n incompleta, vencida o que todavÃ­a no sea vÃ¡lida.
- Reemplazar o eliminar un certificado genera auditorÃ­a y retira el objeto anterior.

Las variables `PRIVATE_STORAGE_*` son obligatorias en producciÃ³n. La identidad del servicio debe tener acceso Ãºnicamente al bucket privado necesario.
