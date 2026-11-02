# Contrato API y validaciones de notas tributarias v1

## Alcance de esta etapa

La API valida, numera y reserva notas de crédito y débito mediante:

- `POST /v1/credit-notes`
- `POST /v1/debit-notes`

Ambas rutas requieren `Authorization: Bearer ...`, el scope `documents:write` e
`Idempotency-Key`. Una creación correcta responde `201`, asigna correlativo,
calcula los tributos y deja el documento en `QUEUED` para generar, firmar y
enviar su XML.

## Solicitud

```json
{
  "externalId": "NC-PEDIDO-1001",
  "referenceDocumentId": "f816b0d3-9c8c-45d9-bcab-a8d729b6a230",
  "series": "FC01",
  "issueDate": "2026-11-02",
  "currency": "PEN",
  "reasonCode": "07",
  "reasonDescription": "Devolución parcial solicitada por el cliente",
  "customer": {
    "documentType": "RUC",
    "documentNumber": "20123456789"
  },
  "adjustments": [
    {
      "referenceLineNumber": 1,
      "quantity": "1",
      "amount": "59.00",
      "description": "Unidad devuelta"
    }
  ]
}
```

`amount` representa el importe total, incluidos tributos, que afecta la línea.
La serie debe estar creada para `CREDIT_NOTE` o `DEBIT_NOTE` en la misma
aplicación y ambiente. Las notas de facturas usan una serie que inicia con `F` y
las notas de boletas una que inicia con `B`.

## Validaciones previas

La API comprueba de forma atómica:

1. El comprobante original pertenece a la misma empresa, aplicación y ambiente.
2. Es una factura o boleta con estado `ACCEPTED` o
   `ACCEPTED_WITH_OBSERVATIONS`.
3. Tipo y número de documento del cliente coinciden con el comprobante.
4. La moneda coincide con la original.
5. El motivo existe en el catálogo SUNAT 09 o 10 correspondiente.
6. La fecha no es anterior al comprobante ni futura.
7. Cada línea existe y no se repite en la solicitud.
8. La cantidad no supera la cantidad pendiente de esa línea.
9. Una nota de crédito no supera el saldo total ni el saldo por línea.
10. Las notas de crédito ya reservadas o aceptadas también consumen saldo; las
    rechazadas o fallidas no lo consumen.

Los motivos de crédito `03` y `13` no consumen importe. El `03` exige la nueva
descripción. Los motivos de anulación o devolución total (`01`, `02`, `06`)
deben cubrir todo el saldo y todas las líneas pendientes.

## Respuesta resumida

```json
{
  "id": "14b64a48-3632-47eb-804d-2d7bb70bd35e",
  "type": "CREDIT_NOTE",
  "status": "QUEUED",
  "fullNumber": "FC01-00000001",
  "validation": {
    "customerVerified": true,
    "currencyVerified": true,
    "sourceAccepted": true,
    "requestedAmount": "59.00",
    "remainingTotalBefore": "118.00",
    "remainingTotalAfter": "59.00"
  },
  "calculation": {
    "version": "NOTE-TAX-v1",
    "taxable": "50.00",
    "tax": "9.00",
    "total": "59.00"
  },
  "message": "Nota calculada y encolada para generar XML y enviar"
}
```

Los datos persistidos también se consultan mediante
`GET /v1/documents/{documentId}` en `reason`, `references` y
`noteAdjustments`.
