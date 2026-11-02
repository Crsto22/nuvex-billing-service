# Solicitudes de baja SUNAT API v1

El servicio registra la solicitud, determina el procedimiento SUNAT y procesa
de forma asíncrona los envíos `RC` y `RA`. La baja de GRE se confirma mediante
el flujo manual de SUNAT SOL.

## Crear baja de factura, boleta o nota

```http
POST /v1/documents/{documentId}/void
Authorization: Bearer <api-key>
Idempotency-Key: void-document-00000001
Content-Type: application/json
```

```json
{
  "reason": "Documento emitido por error",
  "documentDelivered": false
}
```

La API selecciona automáticamente:

- `VOIDED_DOCUMENTS`: factura y notas vinculadas a factura.
- `DAILY_SUMMARY`: boleta y notas vinculadas a boleta.

## Crear solicitud de baja de GRE

```http
POST /v1/despatch-guides/{guideId}/void
Authorization: Bearer <api-key>
Idempotency-Key: void-gre-000000000001
Content-Type: application/json
```

```json
{
  "reason": "Cambio de destinatario",
  "transferStarted": true,
  "recipientChanged": true
}
```

La respuesta usa el procedimiento `GRE_SOL` y el estado `MANUAL_ACTION_REQUIRED`, porque la baja debe registrarse en SUNAT SOL.

Una vez realizada la operacion en SOL, se registra el resultado:

```http
POST /v1/void-requests/{requestId}/manual-confirmation
Authorization: Bearer <api-key>
Idempotency-Key: confirm-gre-sol-00000001
Content-Type: application/json
```

```json
{
  "result": "ACCEPTED",
  "solReference": "SOL-BAJA-0001",
  "notes": "Baja confirmada en SUNAT SOL"
}
```

`ACCEPTED` cambia la GRE a `CANCELLED`. `REJECTED` restaura el estado previo de
la GRE. La referencia de SOL y la evidencia quedan auditadas en la solicitud.

## Webhooks de bajas

Los endpoints pueden suscribirse a:

- `sunat_void.manual_action_required`
- `sunat_void.accepted`
- `sunat_void.rejected`
- `sunat_void.failed`

La entrega usa la misma firma HMAC, politica de reintentos y cola privada de los
demas webhooks del servicio. El payload incluye solicitud, comprobante o GRE,
ticket, respuesta SUNAT y confirmacion manual cuando corresponda.

## Consultar y reintentar

```http
GET /v1/void-requests/{requestId}
POST /v1/void-requests/{requestId}/retry
```

El reintento requiere un `Idempotency-Key` nuevo y solo está permitido cuando la solicitud se encuentra en `FAILED`.

## Generar XML firmado y ZIP

```http
POST /v1/void-requests/{requestId}/artifacts
Authorization: Bearer <api-key>
```

La ruta genera el lote correspondiente al procedimiento de la solicitud:

- `DAILY_SUMMARY`: `SummaryDocuments`, prefijo `RC`, para boletas y sus notas.
- `VOIDED_DOCUMENTS`: `VoidedDocuments`, prefijo `RA`, para facturas y sus
  notas de crédito o débito.

La ruta anterior para resumen diario se mantiene por compatibilidad:

```http
POST /v1/void-requests/{requestId}/daily-summary/artifacts
Authorization: Bearer <api-key>
```

Los documentos se firman con RSA-SHA256 y el XML y ZIP se guardan de forma
privada. La respuesta entrega enlaces temporales de descarga.

- `ConditionCode 3`: el comprobante ya fue informado a SUNAT.
- `ConditionCode 4`: el comprobante fue anulado antes de ser informado.

El nombre sigue el formato `{RUC}-RC|RA-{AAAAMMDD}-{correlativo}.xml|zip`. El
ZIP contiene únicamente el XML firmado con el mismo nombre base.

## Enviar a SUNAT y consultar el resultado

```http
POST /v1/void-requests/{requestId}/submit
Authorization: Bearer <api-key>
```

La respuesta `202` confirma que el trabajo fue encolado. El worker envia el ZIP
mediante `sendSummary`, guarda el ticket y consulta `getStatus` con reintentos y
backoff. Un ticket en estado SUNAT `98` no vuelve a enviar el ZIP.

```http
GET /v1/void-requests/{requestId}
GET /v1/void-requests/{requestId}/cdr
Authorization: Bearer <api-key>
```

La primera ruta muestra el estado de la solicitud, ticket, trabajo asíncrono y
si el CDR está disponible. La segunda entrega un enlace privado temporal al CDR.
Cuando SUNAT acepta la baja, el comprobante cambia a `VOIDED`. Por ahora el
envío SOAP de este flujo está habilitado para el ambiente `BETA`.

## Estados

- `PENDING`
- `MANUAL_ACTION_REQUIRED`
- `SUBMITTED`
- `PROCESSING`
- `ACCEPTED`
- `REJECTED`
- `FAILED`
