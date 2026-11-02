# Motor de cÃ¡lculo tributario v1

El motor aplica una polÃ­tica explÃ­cita y versionada: `PE-SUNAT-UBL21-2026.1`. Cada documento conserva esta versiÃ³n para que una modificaciÃ³n futura de reglas no altere documentos histÃ³ricos.

## PolÃ­tica vigente

- IGV: 18%.
- Redondeo monetario: `HALF_UP` a dos decimales.
- Cantidades, precios y valores unitarios: hasta diez decimales.
- Afectaciones habilitadas: `10` gravado, `20` exonerado y `30` inafecto.
- Los descuentos se aplican sobre el valor de venta sin impuesto.
- Un descuento global se distribuye proporcionalmente entre las lÃ­neas y se registra por separado del descuento propio de cada lÃ­nea.
- Un precio marcado con `unitPriceIncludesTax` se convierte primero a valor unitario sin IGV.
- `taxRate` puede omitirse; si se envÃ­a debe ser `18` para esta versiÃ³n.

La tasa total aplicable de 18% y el cÃ¡lculo del impuesto sobre la base imponible se contrastaron con la [orientaciÃ³n oficial de SUNAT](https://orientacion.sunat.gob.pe/3109-05-calculo-del-impuesto). La estructura de descuentos, bases, impuestos por lÃ­nea y totales sigue la [guÃ­a oficial XML UBL 2.1 para factura](https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia%2Bxml%2Bfactura%2Bversion%202-1%2B1%2B0%20%282%29_0%20%282%29.pdf).

## Resultado auditable

El resultado de `POST /v1/calculations` incluye:

- versiÃ³n de polÃ­tica y modo de redondeo;
- subtotal anterior a descuentos;
- bases gravadas, exoneradas e inafectas;
- descuento total, IGV y total pagable;
- por lÃ­nea: categorÃ­a, tasa, valor unitario, base, descuento propio, descuento global distribuido, impuesto y total.

`GET /v1/calculations/policy` devuelve la versiÃ³n activa, escalas decimales, redondeo, tasa por defecto y afectaciones soportadas.

## Invariantes

El motor comprueba internamente:

```text
subtotal - descuentos = gravado + exonerado + inafecto
gravado + exonerado + inafecto + IGV = total
suma de totales de lÃ­nea = total
```

También rechaza identificadores de lÃ­nea repetidos, cantidades no positivas, precios negativos, descuentos superiores a su base, valores fuera de la precisiÃ³n de PostgreSQL y discrepancias en `expectedTotals`.

## Alcance

Esta versiÃ³n no calcula todavÃ­a operaciones gratuitas, exportaciones, ISC, ICBPER, percepciones, detracciones ni IVAP. Esas reglas deben entrar mediante una nueva versiÃ³n de polÃ­tica y sus propios casos de prueba, sin reinterpretar documentos ya creados.
