# Motor tributario y XML UBL 2.1 de notas

## Cálculo

El motor `NOTE-TAX-v1` recibe los ajustes ya validados contra el comprobante
original y genera líneas tributarias persistentes:

- La nota de crédito representa una disminución positiva del comprobante.
- La nota de débito representa un aumento positivo del comprobante.
- Para operaciones gravadas, distribuye base e IGV conservando la proporción
  tributaria de la línea original.
- Para operaciones exoneradas o inafectas, mantiene el impuesto en cero.
- Redondea importes monetarios a dos decimales y valores unitarios a diez.
- Los motivos de crédito `03` y `13` generan importes cero porque no alteran el
  saldo tributario.

Al crear la nota se persisten `TaxDocumentLine`, los totales, la versión de
cálculo y un trabajo `ISSUE`. El estado inicial operativo es `QUEUED`.

## XML

El worker selecciona el constructor según el tipo de documento:

- `CREDIT_NOTE` genera raíz `CreditNote` UBL 2.1.
- `DEBIT_NOTE` genera raíz `DebitNote` UBL 2.1.

Los XML incluyen `DiscrepancyResponse`, motivo del catálogo SUNAT, referencia y
tipo del comprobante original, emisor, cliente, moneda, impuestos, total y las
líneas `CreditNoteLine` o `DebitNoteLine`. Después se firman con el certificado
de la empresa, se empaquetan en ZIP y se almacenan en el almacenamiento privado.

Las notas de series `F` se envían individualmente mediante `sendBill`. Las notas
de series `B` se informan mediante Resumen Diario, incluyendo la referencia al
comprobante modificado.
