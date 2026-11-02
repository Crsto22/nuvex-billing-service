# Webhooks v1

## Objetivo

Cada aplicación puede registrar destinos HTTPS para recibir cambios del ciclo
de vida de sus comprobantes sin consultar continuamente la API.
Los endpoints quedan aislados por aplicación y ambiente; una API key BETA no
puede administrar ni recibir eventos de PRODUCTION.

Eventos disponibles:

- `document.processing`
- `document.accepted`
- `document.accepted_with_observations`
- `document.rejected`
- `document.retry_scheduled`
- `document.failed`
- `despatch_guide.accepted`
- `despatch_guide.accepted_with_observations`
- `despatch_guide.rejected`

El evento y sus entregas se crean en la misma transacción PostgreSQL que cambia
el estado del documento. La entrega HTTP se realiza posteriormente mediante una
cola durable con `FOR UPDATE SKIP LOCKED`.

## Administración

Todas las operaciones requieren una API key con `webhooks:manage`:

- `GET /v1/webhook-endpoints`
- `POST /v1/webhook-endpoints`
- `PATCH /v1/webhook-endpoints/{endpointId}`
- `DELETE /v1/webhook-endpoints/{endpointId}`
- `POST /v1/webhook-endpoints/{endpointId}/rotate-secret`

El secreto tiene formato `whsec_*`, solo se devuelve al crear o rotar y se
almacena cifrado con AES-256-GCM. Desactivar un endpoint cancela sus entregas
pendientes.

## Solicitud enviada

```http
POST /mi-webhook HTTP/1.1
Content-Type: application/json
User-Agent: Nuvex-Billing-Webhooks/1.0
X-Nuvex-Event-Id: 1bf3...
X-Nuvex-Event: document.accepted
X-Nuvex-Timestamp: 1793577600
X-Nuvex-Signature: v1=hexadecimal...
```

El cuerpo contiene un snapshot mínimo del documento y no incluye credenciales,
claves privadas de almacenamiento ni secretos.

Para `CREDIT_NOTE` y `DEBIT_NOTE`, `data.document.note` informa el motivo y el
comprobante afectado:

```json
{
  "reasonCode": "07",
  "reasonDescription": "Devolución por ítem",
  "referencedDocument": {
    "id": "uuid-del-comprobante",
    "documentType": "INVOICE",
    "series": "F001",
    "number": 42
  }
}
```

La aceptación y el rechazo se notifican tanto para documentos enviados
individualmente como para boletas y sus notas procesadas mediante Resumen
Diario.

Para una GRE, el cuerpo usa `data.despatchGuide` e incluye la serie, correlativo,
destinatario, datos del traslado y la respuesta SUNAT. Los eventos finales se
crean en la misma transacción que persiste el CDR, por lo que nunca se notifica
una aceptación o rechazo antes de guardar el estado definitivo.

## Verificación de firma

La firma es HMAC-SHA256 sobre los bytes UTF-8 de
`<timestamp>.<cuerpo-sin-modificar>`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const signed = `${timestamp}.${rawBody}`;
const expected = `v1=${createHmac('sha256', secret).update(signed).digest('hex')}`;
const valid =
  expected.length === received.length &&
  timingSafeEqual(Buffer.from(expected), Buffer.from(received));
```

El receptor debe usar el cuerpo crudo, rechazar timestamps con más de cinco
minutos de diferencia y guardar `X-Nuvex-Event-Id` para ignorar duplicados.

## Entrega y reintentos

- Cualquier respuesta `2xx` confirma la entrega.
- `408`, `409`, `425`, `429` y `5xx` se reintentan.
- Redirecciones y demás `4xx` son permanentes.
- Se realizan hasta diez intentos con backoff exponencial y jitter.
- La garantía es **al menos una vez**: el consumidor debe ser idempotente.
- No se garantiza orden global entre distintos documentos.

## Seguridad de destinos

- Solo se admite HTTPS.
- Se rechazan credenciales embebidas, nombres locales e IP privadas, loopback,
  link-local o reservadas.
- La resolución DNS se valida al registrar, antes de entregar y dentro de la
  propia conexión TLS para mitigar DNS rebinding.
- No se siguen redirecciones.
- El tiempo máximo predeterminado es diez segundos.

## Configuración

| Variable                   | Predeterminado | Uso                             |
| -------------------------- | -------------: | ------------------------------- |
| `WEBHOOK_POLL_INTERVAL_MS` |           1000 | Sondeo de entregas              |
| `WEBHOOK_CONCURRENCY`      |              8 | Entregas simultáneas por worker |
| `WEBHOOK_LOCK_TIMEOUT_MS`  |          60000 | Recuperación de locks           |
| `WEBHOOK_TIMEOUT_MS`       |          10000 | Tiempo máximo HTTP              |
| `WEBHOOK_RETRY_BASE_MS`    |          10000 | Base del backoff                |
| `WEBHOOK_RETRY_MAX_MS`     |         900000 | Espera máxima                   |
