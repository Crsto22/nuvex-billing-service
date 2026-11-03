# Nuvex Billing API

Microservicio independiente y multiempresa de facturación electrónica para SUNAT, diseñado para ser consumido por Nuvex y por cualquier aplicación externa mediante JSON.

## Estado

Fase 14: pruebas integrales del flujo de emision, CDR, PDF y webhooks.

- Credenciales SUNAT: [`docs/sunat-credentials-v1.md`](docs/sunat-credentials-v1.md).
- Documentos tributarios: [`docs/tax-documents-v1.md`](docs/tax-documents-v1.md).
- Motor de cálculo: [`docs/tax-engine-v1.md`](docs/tax-engine-v1.md).
- XML y firma: [`docs/xml-signature-v1.md`](docs/xml-signature-v1.md).
- Trabajos asíncronos: [`docs/async-jobs-v1.md`](docs/async-jobs-v1.md).
- Envío SUNAT BETA: [`docs/sunat-beta-v1.md`](docs/sunat-beta-v1.md).
- CDR y archivos: [`docs/cdr-and-files-v1.md`](docs/cdr-and-files-v1.md).
- PDF: [`docs/pdf-v1.md`](docs/pdf-v1.md).
- Webhooks: [`docs/webhooks-v1.md`](docs/webhooks-v1.md).
- Pruebas integrales: [`docs/integration-tests.md`](docs/integration-tests.md).
- Almacenamiento privado independiente: [`docs/private-storage.md`](docs/private-storage.md).

## Comandos

```bash
npm install
npm run db:migrate:deploy
npm run start:api:dev
npm run start:worker:dev
npm run check
npm run check:all
```

En Windows puede copiar `.env.local.example` como `.env.local`, configurar la base de datos y el bucket R2 exclusivos del microservicio y ejecutar:

```powershell
.\scripts\start-local.ps1
```

## Docker de producción

El Compose despliega PostgreSQL, ejecuta las migraciones y después inicia la API y el worker. Ambos se conectan automáticamente a PostgreSQL mediante el hostname interno `postgres`.

Guía completa: [`docs/docker-deployment.md`](docs/docker-deployment.md).

```bash
cp .env.production.example .env
# Complete todos los valores REPLACE_WITH_...
docker compose up -d --build
docker compose ps
```

Con Docker Compose clásico use:

```bash
docker-compose up -d --build
docker-compose ps
```

La API queda disponible únicamente en `127.0.0.1:3100` para conectarla de forma segura a Nginx, Caddy o Traefik y publicar `https://billing-api.nuvex.pe`. PostgreSQL no expone ningún puerto al exterior.

La API expone `GET /v1/health`. El worker consume la cola PostgreSQL, genera XML/ZIP firmados, usa `sendBill` para facturas y `sendSummary`/`getStatus` para boletas mediante Resumen Diario en SUNAT BETA, almacena el CDR y aplica reintentos durables.

## Documentos de diseño

- [`docs/openapi-v1.yaml`](docs/openapi-v1.yaml): contrato HTTP inicial.
- [`docs/data-model-v1.md`](docs/data-model-v1.md): entidades, relaciones, reglas e invariantes.
- [`docs/security-v1.md`](docs/security-v1.md): variables, cifrado y controles HTTP.
- [`docs/companies-applications-v1.md`](docs/companies-applications-v1.md): empresas, aplicaciones, API keys y administración.

La API cubre facturas, boletas, notas de crédito y débito, resúmenes diarios, comunicaciones de baja, artefactos XML/ZIP/CDR, PDF y webhooks. La GRE Remitente incluye registro, validación, XML firmado, ZIP, CDR manual y PDF; su transporte REST automático a SUNAT requiere las credenciales API de cada empresa.
