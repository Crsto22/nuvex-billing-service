# Pruebas integrales

La suite integral valida el ciclo de emision dentro de un solo proceso y sin depender de servicios externos:

1. construccion de la factura UBL 2.1;
2. firma XML con un certificado PKCS#12 generado para la prueba;
3. creacion y verificacion del ZIP tributario;
4. envio a un doble controlado de SUNAT BETA;
5. interpretacion y persistencia del CDR;
6. generacion de las representaciones PDF A4 y ticket para documentos aceptados;
7. publicacion y entrega del webhook con firma HMAC-SHA256.

## Escenarios

- Aceptacion: produce XML, ZIP, CDR, `PDF_A4` y `PDF_TICKET`; completa el trabajo y entrega `document.accepted`.
- Rechazo: produce XML, ZIP y CDR; completa el trabajo, no produce representaciones PDF y publica `document.rejected`.

- Factura: valida aceptación y rechazo por envío individual.
- Notas de factura: valida crédito y débito, firma UBL, CDR, PDF y webhooks.
- Boleta y notas de boleta: valida enrutamiento por Resumen Diario para `B001`,
  `BC01` y `BD01`, incluida la publicación de aceptación o rechazo.

PostgreSQL, el almacenamiento privado, SUNAT y el receptor HTTP se sustituyen por adaptadores en memoria. Los motores tributarios, firma XML, parser CDR, PDF, publicador y firma webhook son los servicios reales de la aplicacion.

## Ejecucion

```bash
npm run test:integration
```

Para ejecutar todos los controles del proyecto:

```bash
npm run check:all
```

`check:all` ejecuta validacion Prisma, formato, lint, pruebas unitarias, compilacion, pruebas HTTP E2E y pruebas integrales.

La validacion contra PostgreSQL, almacenamiento S3 compatible y SUNAT BETA reales requiere credenciales e infraestructura separadas. No debe ejecutarse contra SUNAT BETA desde cada commit del CI.
