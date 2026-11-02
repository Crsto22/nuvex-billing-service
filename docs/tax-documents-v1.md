# Documentos tributarios v1

Esta fase implementa el registro transaccional de facturas y boletas. La generaciÃ³n del XML, firma y envÃ­o a SUNAT serÃ¡ ejecutada posteriormente por el worker a partir de `emission_job`.

## PreparaciÃ³n administrativa

Antes de emitir se necesita:

1. Empresa activa con direcciÃ³n y ubigeo.
2. Credenciales SUNAT activas y certificado vigente para el ambiente.
3. Establecimiento activo.
4. Serie fiscal asignada a la aplicaciÃ³n y ambiente.

```text
POST /v1/admin/tenants/{tenantId}/establishments
GET  /v1/admin/tenants/{tenantId}/establishments
POST /v1/admin/tenants/{tenantId}/fiscal-series
GET  /v1/admin/tenants/{tenantId}/fiscal-series
```

Las series `INVOICE` empiezan con `F` y las series `RECEIPT` con `B`. `initialNumber` permite continuar una numeraciÃ³n existente; el primer documento usarÃ¡ el siguiente nÃºmero.

## Operaciones de aplicaciones

```text
POST /v1/calculations
POST /v1/documents
GET  /v1/documents
GET  /v1/documents/{documentId}
```

`POST /documents` requiere `Idempotency-Key` de 16 a 100 caracteres. Repetir la misma clave con el mismo payload devuelve el resultado original; reutilizarla con otro payload devuelve `409`.

Scopes:

- `calculations:write`: simulaciÃ³n tributaria.
- `documents:write`: creaciÃ³n de documentos.
- `documents:read`: consulta y listado.

## Reglas v1

- Tipos: factura (`INVOICE`, SUNAT 01) y boleta (`RECEIPT`, SUNAT 03).
- Afectaciones soportadas inicialmente: gravado `10`, exonerado `20` e inafecto `30`.
- IGV por defecto: 18%; `taxRate` representa un porcentaje.
- Todos los importes usan decimal exacto y redondeo comercial a dos decimales.
- Facturas v1 requieren cliente con RUC de 11 dÃ­gitos.
- Ventas al crÃ©dito requieren cuotas cuya suma coincida con el total.
- `expectedTotals` detecta diferencias con el cÃ¡lculo del sistema origen.
- El correlativo se incrementa en la misma transacciÃ³n que documento, lÃ­neas, cuotas, trabajo, idempotencia y auditorÃ­a.
- Los documentos son snapshots y no dependen de productos o clientes de Nuvex.
