# Almacenamiento privado compartido con Nuvex

Billing API utiliza el mismo bucket privado de Cloudflare R2 configurado en el backend Nuvex. No necesita un segundo bucket ni otro proveedor.

## Configuracion

Configure en Billing API los mismos valores secretos que ya utiliza Nuvex:

```dotenv
CLOUDFLARE_R2_ACCOUNT_ID=...
CLOUDFLARE_R2_ACCESS_KEY_ID=...
CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
CLOUDFLARE_R2_PRIVATE_BUCKET=...
CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS=300
```

`CLOUDFLARE_R2_ACCOUNT_ID` se transforma internamente en el endpoint S3 compatible de R2. El bucket publico de imagenes no se utiliza en este microservicio.

Las variables genericas `PRIVATE_STORAGE_*` siguen siendo compatibles y tienen prioridad cuando estan presentes. Esto permite usar otro proveedor S3 compatible en una instalacion independiente.

## Separacion de objetos

Aunque el bucket es compartido, Billing API mantiene su propio espacio de claves:

```text
tenants/{tenantId}/{beta|production}/certificates/...
tenants/{tenantId}/{beta|production}/documents/{yyyy}/{mm}/{documentId}/...
```

Nuvex conserva sus rutas existentes bajo `sunat/`, `sunat-certificates/`, `logos/` y las carpetas de productos. Por ello no existen colisiones entre ambos sistemas.

Los XML, ZIP, CDR, PDF A4, PDF ticket y certificados permanecen privados. La API solo devuelve URLs firmadas con una vigencia de 60 a 900 segundos.

## Seguridad operativa

- No copie credenciales R2 al repositorio ni a archivos versionados.
- Inyecte los valores mediante el gestor de secretos del entorno de despliegue.
- La credencial debe limitarse al bucket privado compartido.
- Mantenga deshabilitado el acceso publico al bucket.
- La base de datos guarda solamente claves de objetos y metadatos de integridad SHA-256.
