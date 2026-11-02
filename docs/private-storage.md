# Almacenamiento privado independiente

Billing API utiliza un bucket privado de Cloudflare R2 exclusivo para el microservicio. No lee configuración, credenciales ni archivos del backend de Nuvex.

## Configuración

Configure valores propios para Billing API:

```dotenv
CLOUDFLARE_R2_ACCOUNT_ID=...
CLOUDFLARE_R2_ACCESS_KEY_ID=...
CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
CLOUDFLARE_R2_PRIVATE_BUCKET=...
CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS=300
```

`CLOUDFLARE_R2_ACCOUNT_ID` se transforma internamente en el endpoint S3 compatible de R2. El bucket debe permanecer privado.

Las variables genéricas `PRIVATE_STORAGE_*` también son compatibles y tienen prioridad cuando están presentes, permitiendo usar otro proveedor S3 compatible.

## Separación de objetos

Cada empresa y ambiente tiene su propio prefijo:

```text
tenants/{tenantId}/{beta|production}/certificates/...
tenants/{tenantId}/{beta|production}/documents/{yyyy}/{mm}/{documentId}/...
tenants/{tenantId}/{beta|production}/despatch-guides/...
```

Los XML, ZIP, CDR, PDF A4, PDF ticket y certificados permanecen privados. La API entrega URLs firmadas con vigencia limitada.

## Seguridad operativa

- No confirme credenciales R2 ni archivos `.env.local` en Git.
- Inyecte los valores mediante el gestor de secretos del despliegue.
- Limite la credencial al bucket exclusivo de Billing.
- Mantenga deshabilitado el acceso público al bucket.
- La base de datos guarda solamente claves de objetos y metadatos de integridad SHA-256.
