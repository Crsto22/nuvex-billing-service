# Resumen Diario v1

## Alcance

Las facturas continúan enviándose individualmente mediante `sendBill`. Las boletas
y, en la siguiente fase, sus notas electrónicas con serie `B`, se informan mediante
Resumen Diario.

## Flujo

1. El worker genera y conserva el XML individual firmado de la boleta.
2. Crea un `daily_summary` con fecha de referencia, fecha de generación y secuencia diaria.
3. Registra la boleta en `daily_summary_item` con condición `1` (adicionar).
4. Construye y firma `SummaryDocuments`, guarda XML y ZIP en almacenamiento privado.
5. Ejecuta `sendSummary` y persiste el ticket antes de consultar SUNAT.
6. Ejecuta `getStatus`. El estado `98` conserva el ticket y programa un reintento durable.
7. Al recibir el CDR, actualiza el resumen, la boleta, su artefacto `CDR` y publica el webhook final.

Cada envío utiliza un identificador `RC-YYYYMMDD-NNN` único por empresa, ambiente y
fecha de generación. Esta versión crea un lote independiente por documento para
evitar cerrar un lote mientras otra aplicación todavía incorpora boletas; el modelo
permite agrupar varios documentos en una optimización posterior.

## Modelo preparado para notas

`DocumentType` incorpora `CREDIT_NOTE` y `DEBIT_NOTE`. La tabla
`tax_document_reference` conserva el documento modificado, su tipo, serie y número.
`reason_code` y `reason_description` quedan reservados en `tax_document`.

La ruta pública `POST /v1/documents` continúa aceptando únicamente `INVOICE` y
`RECEIPT` hasta que se implementen las validaciones, cálculo y XML UBL de las notas.
