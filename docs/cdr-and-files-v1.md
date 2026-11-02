# CDR y archivos tributarios v1

## Archivos persistidos

Cada documento puede conservar artefactos privados tributarios y de representación:

- `XML`: comprobante UBL 2.1 firmado.
- `ZIP`: XML firmado enviado a SUNAT.
- `CDR`: ZIP de respuesta recibido de SUNAT.
- `PDF_A4`: representación formal A4 generada para comprobantes aceptados.
- `PDF_TICKET`: representación térmica de 80 mm generada para comprobantes aceptados.
- `PDF`: formato histórico conservado solo para documentos anteriores a la migración.

La base de datos guarda solamente metadatos y la clave privada del objeto. La API
nunca expone esa clave. Cada artefacto registra nombre, tipo MIME, tamaño y SHA-256.

## Inmutabilidad e integridad

Antes del primer envío, XML y ZIP pueden generarse nuevamente de forma idempotente.
Después de registrar `submittedAt`, ambos se consideran inmutables: los reintentos
reutilizan los artefactos existentes y fallan si falta alguno. Antes de invocar
SUNAT, el worker vuelve a calcular el tamaño y SHA-256 del ZIP y los compara con
los metadatos persistidos.

El CDR se persiste como `R-<nombre-del-zip-enviado>`. Su código, mensaje y lista de
observaciones también se guardan de forma estructurada en el documento.

## API

- `GET /v1/documents/{documentId}/artifacts` lista metadatos de los archivos.
- `GET /v1/documents/{documentId}/artifacts/{artifactType}` entrega una URL
  prefirmada con vigencia de cinco minutos, junto con tamaño y SHA-256.

Ambas operaciones exigen `documents:read` y limitan el acceso a la aplicación y
ambiente autenticados. No existe una operación pública de borrado ni se configura
eliminación automática en esta versión.

## Recuperación ante fallos

- Un ZIP ausente o con hash/tamaño incorrectos produce un error recuperable y no
  se transmite a SUNAT.
- Una respuesta CDR inválida no se registra como aceptación o rechazo.
- Si ya existe un CDR final, el trabajo es idempotente y no reenvía el comprobante.
- Los errores SOAP permanentes conservan el primer `submittedAt`; un reintento usa
  los mismos XML y ZIP.
