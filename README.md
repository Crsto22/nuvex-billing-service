# Nuvex Billing API

Microservicio multiempresa de facturación electrónica para SUNAT, diseñado para ser consumido por Nuvex y por aplicaciones externas.

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
- Almacenamiento privado compartido: [`docs/private-storage.md`](docs/private-storage.md).

## Comandos

```bash
npm install
npm run start:api:dev
npm run start:worker:dev
npm run check
npm run check:all
```

La API expone `GET /v1/health`. El worker consume la cola PostgreSQL, genera XML/ZIP firmados, usa `sendBill` para facturas y `sendSummary`/`getStatus` para boletas mediante Resumen Diario en SUNAT BETA, almacena el CDR y aplica reintentos durables.

## Documentos de diseño

- [`docs/openapi-v1.yaml`](docs/openapi-v1.yaml): contrato HTTP inicial.
- [`docs/data-model-v1.md`](docs/data-model-v1.md): entidades, relaciones, reglas e invariantes.
- [`docs/security-v1.md`](docs/security-v1.md): variables, cifrado y controles HTTP.
- [`docs/companies-applications-v1.md`](docs/companies-applications-v1.md): empresas, aplicaciones, API keys y administración.

La emisión pública actual cubre facturas y boletas. El modelo ya reserva notas de crédito y débito con referencias al comprobante original; sus contratos y constructores UBL se incorporarán en la siguiente fase sin romper `/v1`.
