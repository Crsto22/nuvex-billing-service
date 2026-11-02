# Envio SUNAT BETA v1

## Alcance

El worker envía facturas individuales mediante SOAP `sendBill`. Las boletas se
informan mediante un Resumen Diario firmado con `sendSummary`; el ticket se consulta
con `getStatus` hasta recibir el CDR. BETA solo valida estructuras de prueba y no debe utilizarse para
comprobantes reales ni pruebas de carga.

Endpoint por defecto:

```text
https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService
```

## Autenticacion

Se utiliza WS-Security `UsernameToken`. SUNAT define para BETA:

```text
Username = {RUC}MODDATOS
Password = MODDATOS
```

La API conserva usuario y clave cifrados por tenant y ambiente. El worker los
descifra en memoria, concatena el RUC cuando el usuario almacenado no lo incluye
y nunca registra las credenciales en logs.

## Flujo ISSUE

1. Reclamar el job PostgreSQL.
2. Generar y firmar XML UBL 2.1.
3. Crear o reemplazar el ZIP firmado de forma idempotente.
4. Cargar credenciales SOL BETA.
5. Para facturas, enviar `fileName` y ZIP en base64 mediante `sendBill`.
6. Para boletas, construir el Resumen Diario, enviarlo mediante `sendSummary` y conservar el ticket.
7. Consultar el ticket mediante `getStatus`; el código `98` se reintenta y el CDR final se persiste.
6. Recibir el ZIP CDR sincrono.
7. Verificar ZIP, XML, campos obligatorios y `ReferenceID`.
8. Guardar `R-{nombre}.zip` en almacenamiento privado.
9. Persistir resultado, auditoria y finalizar el job.

## Estados

| Respuesta | Documento | Job |
|---|---|---|
| CDR código `0` sin notas | `ACCEPTED` | `DONE` |
| CDR código `0` con notas | `ACCEPTED_WITH_OBSERVATIONS` | `DONE` |
| CDR código distinto de `0` | `REJECTED` | `DONE` |
| Excepción SUNAT 0100–0999, HTTP 5xx, red o timeout | `RETRY_SCHEDULED` | `PENDING` |
| Excepción de cliente 1000–1999 | `FAILED` | `DEAD` |

Los errores 2000–3999 llegan normalmente dentro de un CDR rechazado. Las
observaciones 4000 en adelante llegan como notas en un CDR aceptado.

## Idempotencia

Antes de enviar, el servicio comprueba si ya existe un CDR final persistido. Si
el worker cayo despues de guardar el CDR pero antes de completar el job, el
reintento reutiliza el resultado local y no vuelve a llamar a SUNAT.

XML, ZIP y CDR tienen rutas deterministas y unicidad por documento/tipo.

## Seguridad de respuestas

- Solo se permite endpoint HTTPS.
- Timeout de red configurable.
- Limite para solicitud y respuesta.
- Lectura HTTP incremental con corte por tamano.
- El CDR debe ser un ZIP valido con exactamente un XML.
- Se rechazan nombres de entrada con traversal.
- El XML CDR debe corresponder a la serie y numero enviados.
- Nunca se guarda el SOAP con credenciales.

## Configuracion

```env
SUNAT_BETA_BILL_ENDPOINT=https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService
SUNAT_SOAP_TIMEOUT_MS=60000
SUNAT_MAX_RESPONSE_BYTES=10485760
```

La integracion real requiere PostgreSQL, almacenamiento privado, certificado de
firma y credenciales BETA activas. Las pruebas automatizadas simulan SOAP y CDR;
no realizan envios al servicio publico de SUNAT.
