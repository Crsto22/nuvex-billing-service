# GRE Remitente: modelo y contrato API v1

## Alcance

Esta etapa registra, numera, consulta y cancela localmente una Guía de Remisión
Electrónica Remitente. Una guía recién creada queda en `REGISTERED`. La API ya
genera el XML `DespatchAdvice` UBL 2.1, lo firma y crea el ZIP; todavía no se
considera emitida ni aceptada hasta enviarla a SUNAT y procesar su CDR.

La serie fiscal debe estar asignada como `DESPATCH_GUIDE`, cumplir `T###` y usar
un correlativo entre `1` y `99999999`.

## Rutas

```text
POST /v1/despatch-guides
POST /v1/despatch-guides/{guideId}/submit
GET  /v1/despatch-guides
GET  /v1/despatch-guides/{guideId}
POST /v1/despatch-guides/{guideId}/artifacts
POST /v1/despatch-guides/{guideId}/cdr
POST /v1/despatch-guides/{guideId}/artifacts/pdf-a4
GET  /v1/despatch-guides/{guideId}/artifacts
GET  /v1/despatch-guides/{guideId}/artifacts/{XML|ZIP|CDR|PDF_A4}
POST /v1/despatch-guides/{guideId}/cancel
```

`POST /submit` crea un trabajo durable. En `BETA` genera y valida los artefactos
sin enviarlos a SUNAT y finaliza como `VALIDATED_BETA`. En `PRODUCTION` exige
usuario/clave SOL, `client_id`, `client_secret` y certificado activos; obtiene
el token REST, envia el ZIP, consulta el ticket y procesa el CDR. Los endpoints
pueden sobrescribirse para pruebas controladas mediante `SUNAT_GRE_TOKEN_URL`
y `SUNAT_GRE_API_URL`.

`relatedDocuments` admite multiples documentos del Catalogo 61. El campo
singular `relatedDocument` se mantiene como entrada compatible.

## Webhooks

Al procesar el CDR se publican `despatch_guide.accepted`,
`despatch_guide.accepted_with_observations` o `despatch_guide.rejected`. La
entrega usa la misma firma HMAC-SHA256, reintentos e idempotencia documentados
para los demás webhooks de la API.

## Pruebas oficiales SUNAT

La nueva plataforma GRE no ofrece un ambiente de envío BETA. Según las
preguntas frecuentes oficiales de SUNAT, la validación previa debe realizarse
con el Sistema Facturador SUNAT (SFS). Por tanto, `environment=BETA` en esta API
sirve para pruebas internas, generación, firma y validaciones controladas, pero
no representa una aceptación real de SUNAT.

El envío real de la nueva GRE usa los servicios REST de producción y requiere
`client_id` y `client_secret` generados en SOL, además del usuario y clave SOL.
Nunca se debe conectar el ambiente BETA interno con el antiguo WebService SOAP
de guías y presentar su respuesta como validación de la plataforma nueva.

Referencias oficiales:

- https://cpe.sunat.gob.pe/node/122
- https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual_Servicios_GRE.pdf

Crear y cancelar requieren `documents:write` e `Idempotency-Key`. Generar los
archivos requiere `documents:write`; listarlos o descargarlos requiere
`documents:read`.

## XML, firma y ZIP

`POST /v1/despatch-guides/{guideId}/artifacts` genera y firma el XML con el
certificado activo de la empresa para el ambiente de la API key. Los archivos
se guardan en el almacenamiento privado y la descarga devuelve una URL temporal.

El XML usa `DespatchAdviceTypeCode=09`. El nombre exigido para la GRE remitente
usa el tipo `31`:

```text
20615136663-09-T001-3.xml
20615136663-09-T001-3.zip
```

El ZIP contiene solamente el XML firmado con el mismo nombre base. La API
conserva el `DigestValue`, SHA-256, tamaño, tipo MIME y fecha de creación.

## CDR y representación A4

El adaptador de transporte SUNAT entrega el ZIP CDR mediante `multipart/form-data`
en el campo `cdr` de `POST /v1/despatch-guides/{guideId}/cdr`. La API verifica
que el CDR corresponda a la serie y correlativo de la GRE, guarda el archivo y
actualiza el estado a `ACCEPTED`, `ACCEPTED_WITH_OBSERVATIONS` o `REJECTED`.
Un ZIP inválido, vacío, con más de un XML o perteneciente a otra guía es
rechazado.

Después de una aceptación, `POST
/v1/despatch-guides/{guideId}/artifacts/pdf-a4` crea la representación impresa
A4. Incluye emisor, destinatario, emisión, motivo, ruta, modalidad, peso,
bultos, transportista o vehículo/conductor, bienes, respuesta CDR y QR de
identificación unívoca. El PDF no se genera para una GRE rechazada o sin CDR.

## Ejemplo de creación privada

```json
{
  "externalId": "TRASLADO-1001",
  "series": "T001",
  "issueDate": "2026-11-02",
  "transferStartDate": "2026-11-03",
  "transferReasonCode": "01",
  "transferReasonDescription": "Venta",
  "transportMode": "PRIVATE",
  "grossWeight": "125.500",
  "weightUnit": "KGM",
  "packageCount": 10,
  "recipient": {
    "documentType": "RUC",
    "documentNumber": "20100070970",
    "name": "CLIENTE PRUEBA SAC",
    "address": "AV. DESTINO 100, LIMA",
    "ubigeo": "150101"
  },
  "departure": {
    "ubigeo": "150132",
    "address": "AV. LOS CIRUELOS 500, LIMA"
  },
  "arrival": {
    "ubigeo": "150101",
    "address": "AV. DESTINO 100, LIMA"
  },
  "vehicles": [
    {
      "plate": "ABC123",
      "brand": "VOLVO",
      "primary": true
    }
  ],
  "drivers": [
    {
      "documentType": "DNI",
      "documentNumber": "12345678",
      "firstNames": "JUAN",
      "lastNames": "PEREZ",
      "licenseNumber": "Q12345678",
      "primary": true
    }
  ],
  "items": [
    {
      "externalId": "ITEM-1",
      "sku": "SKU-1",
      "description": "PRODUCTO DE PRUEBA",
      "quantity": "10",
      "unitCode": "NIU"
    }
  ]
}
```

En transporte `PUBLIC`, `carrier` es obligatorio. En transporte `PRIVATE`, se
requiere al menos un vehículo y un conductor, con exactamente uno principal de
cada tipo.

Para transporte público también se envía `carrierDeliveryDate`. Los vehículos y
conductores del remitente solo corresponden a transporte privado.

## Validaciones SUNAT

- Motivos: Catálogo 20 (`01`, `02`, `03`, `04`, `05`, `06`, `07`, `08`, `09`,
  `13`, `14`, `17`, `18`, `19`). El código `13` exige una descripción.
- Modalidades: `PUBLIC` se transforma a SUNAT `01`; `PRIVATE`, a `02`.
- Documentos: se aceptan únicamente los aplicables a GRE remitente del Catálogo
  61 y se valida el formato del número. Importación/exportación requieren DAM
  (`50`) o DS (`52`); mercancía extranjera admite `50`, `52`, `91` o `92`.
- Ubigeos: partida, llegada y destinatario se contrastan con el Catálogo 13
  oficial. El motivo itinerante `18` no informa llegada.
- Peso: positivo, hasta 12 enteros y 3 decimales, en `KGM` o `TNE`.
- Fechas: la emisión debe ser de hoy o ayer en Perú y nunca futura. El inicio no
  puede preceder a la emisión; en transporte público tampoco puede preceder a la
  entrega al transportista.

La respuesta agrega `reasonName`, `transportModeCode` y
`deliveryDateToCarrier`, conservando los valores amigables de la API.

## Cancelación

Una guía `REGISTERED`, `REJECTED` o `FAILED` que nunca fue enviada se marca
`CANCELLED` localmente. Si ya fue enviada, la API la deja en
`CANCELLATION_REQUESTED`; el envío de la baja a SUNAT pertenece a una etapa
posterior.

## Referencias oficiales

- https://cpe.sunat.gob.pe/node/116
- https://cpe.sunat.gob.pe/node/171
- https://orientacion.sunat.gob.pe/guia-de-remision-electronica-modelo-general
