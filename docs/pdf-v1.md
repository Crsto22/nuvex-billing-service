# Representaciones impresas PDF v1

## Alcance

Cada factura o boleta aceptada por SUNAT genera dos representaciones legibles:

- `PDF_A4`: hoja formal A4 para envío digital, archivo y operaciones B2B.
- `PDF_TICKET`: formato térmico de 80 mm para impresión en punto de venta.

Los PDF no reemplazan al XML UBL firmado ni se envían a SUNAT. Solo se generan después de recibir un CDR `ACCEPTED` o `ACCEPTED_WITH_OBSERVATIONS`.

## Contenido

Ambos diseños muestran:

- denominación y RUC del emisor;
- tipo de comprobante, serie y correlativo;
- fecha, moneda, cliente y documento del cliente cuando corresponda;
- detalle de productos o servicios;
- base gravada, IGV, descuentos y total;
- total en letras y cuotas de crédito cuando correspondan;
- estado y código SUNAT;
- valor resumen del XML firmado;
- código QR tributario;
- indicación de que se trata de una representación impresa.

El título se adapta al documento: `FACTURA ELECTRÓNICA` o `BOLETA DE VENTA ELECTRÓNICA`, independientemente del formato físico.

## Código QR SUNAT

El QR usa corrección de errores nivel Q, UTF-8, color negro y zona blanca. Su contenido sigue este orden, separado por `|`:

```text
RUC|TIPO|SERIE|NÚMERO|IGV|TOTAL|FECHA|TIPO_DOC_CLIENTE|DOC_CLIENTE|VALOR_RESUMEN|
```

Los códigos son `01` para factura y `03` para boleta. El valor resumen proviene del `DigestValue` del XML firmado.

La estructura sigue el [Anexo C de la Resolución 113-2018/SUNAT](https://www.sunat.gob.pe/legislacion/superin/2018/anexoC-113-2018.pdf) y la [orientación oficial para emisores electrónicos](https://orientacion.sunat.gob.pe/4-efectos-de-ser-emisor-electronico).

## Persistencia y descarga

El worker almacena ambos archivos en el bucket privado, registra tamaño y SHA-256 y evita volver a generar formatos ya existentes.

Rutas:

- `GET /v1/documents/{documentId}/artifacts`
- `GET /v1/documents/{documentId}/artifacts/PDF_A4`
- `GET /v1/documents/{documentId}/artifacts/PDF_TICKET`

Las rutas de descarga devuelven una URL temporal firmada. El tipo histórico `PDF` se conserva para consultar documentos emitidos antes de esta mejora, pero no se crea para documentos nuevos.

## Restricciones

- Un documento rechazado o sin respuesta SUNAT no produce PDF.
- Los importes provienen del motor tributario persistido; el renderizador no los recalcula.
- Los PDF no modifican XML, firma, ZIP ni CDR.
- La versión actual usa identidad textual y no incorpora logotipos cargados por la empresa.
