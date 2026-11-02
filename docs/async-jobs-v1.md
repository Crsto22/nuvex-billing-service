# Trabajos asincronos v1

## Objetivo

La emision no se ejecuta dentro de la solicitud HTTP. La API valida y persiste
el documento, reserva la numeracion y crea un `emission_job`. El worker procesa
la cola durable en PostgreSQL.

`ISSUE` genera, firma y almacena XML/ZIP, los envía a SUNAT BETA, procesa el CDR
y, si SUNAT acepta el comprobante, genera las representaciones PDF A4 y ticket. Luego
finaliza el documento como aceptado, aceptado con observaciones o rechazado.

## Garantia de ejecucion

La cola ofrece entrega **al menos una vez**. No promete exactamente una vez:
un worker puede caer despues de ejecutar un efecto y antes de confirmar el
trabajo. Por eso la generacion de artefactos es idempotente:

- los nombres y object keys son deterministas;
- `artifact` tiene unicidad `(document_id, type)`;
- la persistencia usa `upsert`;
- antes del primer envío, repetir XML/ZIP reemplaza el mismo objeto privado;
- después del primer envío, XML/ZIP son inmutables y se reutilizan sin regenerar.

## Reclamacion atomica

El worker selecciona un trabajo elegible usando una unica sentencia PostgreSQL
con `FOR UPDATE SKIP LOCKED` y lo actualiza a `PROCESSING`. Esto permite ejecutar
varias replicas sin que dos reclamen simultaneamente el mismo registro.

Son elegibles:

- `PENDING` cuyo `next_attempt_at` ya vencio;
- `PROCESSING` cuyo `locked_at` excedio el timeout, para recuperar workers caidos.

Cada reclamacion incrementa `attempts`, asigna un `locked_by` unico y actualiza
`locked_at`. Mientras procesa, el worker renueva el bloqueo cada tercio del
timeout.

## Reintentos

Los errores transitorios usan backoff exponencial con jitter y limite maximo.
Ejemplos: HTTP 408, 429, 5xx, almacenamiento temporalmente indisponible y errores
de conexion/pool de Prisma.

Los errores de validacion 4xx son permanentes. Un error permanente o alcanzar
`max_attempts` mueve el job a `DEAD` y el documento a `FAILED`. Un error
reintentable mueve el job a `PENDING`, establece `next_attempt_at` y deja el
documento en `RETRY_SCHEDULED`.

## Concurrencia y apagado

Cada proceso admite concurrencia configurable. Al recibir una señal de apagado:

1. deja de reclamar trabajos;
2. espera los trabajos en vuelo;
3. libera la conexion al cerrar el contexto NestJS.

Si el proceso termina abruptamente, los locks vencen y otro worker los recupera.

## Configuracion

| Variable | Default | Uso |
|---|---:|---|
| `WORKER_POLL_INTERVAL_MS` | 1000 | Pausa cuando no hay trabajo |
| `WORKER_CONCURRENCY` | 4 | Trabajos simultaneos por proceso |
| `WORKER_LOCK_TIMEOUT_MS` | 120000 | Tiempo para recuperar un lock |
| `WORKER_RETRY_BASE_MS` | 5000 | Base del backoff exponencial |
| `WORKER_RETRY_MAX_MS` | 900000 | Espera maxima entre intentos |

Para escalar horizontalmente se levantan varias instancias con la misma base de
datos y bucket. `SKIP LOCKED` distribuye el trabajo entre ellas.

## Observabilidad

Los logs son JSON e incluyen `event`, `workerId`, `jobId`, `documentId`, intento,
duracion y codigo de error, sin credenciales ni payload tributario. Eventos:

- `worker.started`, `worker.stopping`, `worker.poll_failed`;
- `emission_job.completed`, `emission_job.retry_scheduled`;
- `emission_job.dead`, `emission_job.lock_lost`;
- `emission_job.heartbeat_failed`.
