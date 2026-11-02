# XML UBL 2.1 y firma digital v1

## Alcance

La primera version genera comprobantes SUNAT para:

- Factura (`InvoiceTypeCode` 01, serie F).
- Boleta (`InvoiceTypeCode` 03, serie B).
- Monedas PEN y USD admitidas por el contrato de documentos.
- Operacion interna `ProfileID` 0101.
- IGV gravado 10, exonerado 20 e inafecto 30.
- Pago al contado y al credito con cuotas.

Notas de credito/debito, anticipos, detracciones, percepciones, ISC, exportaciones
y operaciones gratuitas quedan fuera de esta version.

## Flujo

1. El generador toma exclusivamente el documento normalizado y sus snapshots.
2. Construye un `Invoice` UBL 2.1 sin consultar datos mutables de Nuvex.
3. Recupera el PKCS#12 privado del ambiente del emisor.
4. Descifra la clave del certificado usando el contexto del tenant y ambiente.
5. Firma el nodo raiz con XMLDSIG enveloped, RSA-SHA256 y digest SHA-256.
6. Inserta `ds:Signature` en `ext:ExtensionContent`.
7. Crea el ZIP que contiene un unico XML firmado.
8. Guarda XML y ZIP en almacenamiento privado y registra tamano y SHA-256.

## Nombres fiscales

El nombre base es:

```text
{RUC}-{01|03}-{SERIE}-{NUMERO}
```

Ejemplo:

```text
20123456789-01-F001-42.xml
20123456789-01-F001-42.zip
```

La ruta privada separa tenant, ambiente, fecha y documento:

```text
tenants/{tenantId}/{beta|production}/documents/{YYYY}/{MM}/{documentId}/archivo
```

## Persistencia

La tabla `artifact` conserva un registro por documento y tipo (`XML`, `ZIP`,
`CDR`, `PDF`). En este paso solo se generan XML y ZIP. El `objectKey` no se
expone al cliente; la respuesta del documento muestra metadatos no sensibles:
nombre, MIME, tamano, SHA-256 y fecha.

`tax_document.sunat_hash` guarda temporalmente el `DigestValue` del XML firmado.
El CDR y la respuesta SUNAT se incorporan en el siguiente paso del pipeline.

## Invariantes de seguridad

- El PKCS#12 nunca se escribe en disco local ni se incluye en logs.
- La contrasena permanece cifrada en PostgreSQL.
- La firma se realiza en memoria.
- XML y ZIP se guardan en bucket privado.
- El certificado elegido debe pertenecer al mismo tenant y ambiente.
- Ningun campo puede agregarse al XML despues de firmarlo.

## Pruebas

Las pruebas unitarias comprueban XML bien formado, codigos 01/03, totales,
estructura UBL y una firma criptograficamente verificable. La validacion final
contra las reglas vigentes de SUNAT se hara al integrar el servicio beta, pues
esas reglas son adicionales al esquema XSD.
