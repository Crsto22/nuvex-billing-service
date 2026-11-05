import { ConfigService } from '@nestjs/config';
import { Environment } from '@prisma/client';
import {
  SunatSoapClientService,
  SunatSoapFaultException,
  SunatTransportException,
} from './sunat-soap-client.service';

describe('SunatSoapClientService', () => {
  const originalFetch = global.fetch;
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'SUNAT_BETA_BILL_ENDPOINT')
        return 'https://beta.sunat.test/bill';
      if (key === 'SUNAT_PRODUCTION_BILL_ENDPOINT')
        return 'https://production.sunat.test/bill';
      if (key === 'SUNAT_SOAP_TIMEOUT_MS') return 60_000;
      return 10_485_760;
    }),
  } as unknown as ConfigService;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('envia sendBill con WS-Security y obtiene el ZIP CDR', async () => {
    const expected = Buffer.from('cdr-zip');
    const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
    fetchMock.mockResolvedValue(
      soapResponse(
        `<ser:sendBillResponse xmlns:ser="http://service.sunat.gob.pe"><applicationResponse>${expected.toString('base64')}</applicationResponse></ser:sendBillResponse>`,
      ),
    );
    global.fetch = fetchMock;

    const result = await new SunatSoapClientService(config).sendBill({
      environment: Environment.BETA,
      username: '20123456789MODDATOS',
      password: 'MODDATOS',
      fileName: '20123456789-01-F001-42.zip',
      zip: Buffer.from('zip'),
    });

    expect(result.cdrZip).toEqual(expected);
    const request = fetchMock.mock.calls[0]?.[1];
    const body = request?.body;
    if (typeof body !== 'string') throw new Error('SOAP body no disponible');
    expect(body).toContain('<ser:sendBill>');
    expect(body).toContain('20123456789MODDATOS');
    expect(body).toContain('20123456789-01-F001-42.zip');
  });

  it('selecciona el receptor productivo para una API key live', async () => {
    const cdr = Buffer.from('production-cdr');
    const fetchMock: jest.MockedFunction<typeof fetch> = jest
      .fn()
      .mockResolvedValue(
        soapResponse(
          `<applicationResponse>${cdr.toString('base64')}</applicationResponse>`,
        ),
      );
    global.fetch = fetchMock;

    await new SunatSoapClientService(config).sendBill({
      ...input(),
      environment: Environment.PRODUCTION,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://production.sunat.test/bill',
    );
  });

  it('clasifica una falla Server como transitoria', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        soapResponse(
          '<soap-env:Fault><faultcode>soap-env:Server.0835</faultcode><faultstring>Temporal</faultstring></soap-env:Fault>',
          500,
        ),
      );
    await expect(
      new SunatSoapClientService(config).sendBill(input()),
    ).rejects.toBeInstanceOf(SunatTransportException);
  });

  it('clasifica una falla Client como permanente', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        soapResponse(
          '<soap-env:Fault><faultcode>soap-env:Client.1032</faultcode><faultstring>ZIP invalido</faultstring></soap-env:Fault>',
          500,
        ),
      );
    await expect(
      new SunatSoapClientService(config).sendBill(input()),
    ).rejects.toBeInstanceOf(SunatSoapFaultException);
  });

  it('clasifica un XML invalido como permanente aunque SUNAT use Server', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        soapResponse(
          '<soap-env:Fault><faultcode>soap-env:Server</faultcode><faultstring>No se puede leer (parsear) el archivo XML - cvc-particle 2.1</faultstring></soap-env:Fault>',
          500,
        ),
      );
    await expect(
      new SunatSoapClientService(config).sendSummary(input()),
    ).rejects.toBeInstanceOf(SunatSoapFaultException);
  });

  it('envia el Resumen Diario y obtiene el ticket', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        soapResponse(
          '<ser:sendSummaryResponse xmlns:ser="http://service.sunat.gob.pe"><ticket>202611020000123</ticket></ser:sendSummaryResponse>',
        ),
      );

    await expect(
      new SunatSoapClientService(config).sendSummary(input()),
    ).resolves.toEqual({ ticket: '202611020000123' });
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    const request = fetchMock.mock.calls[0]?.[1];
    if (!request) throw new Error('SOAP request no disponible');
    expect(request.headers).toMatchObject({ SOAPAction: '"urn:sendSummary"' });
    if (typeof request.body !== 'string') {
      throw new Error('SOAP body no disponible');
    }
    expect(request.body).toContain('<ser:sendSummary>');
  });

  it('consulta un ticket pendiente del Resumen Diario', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        soapResponse(
          '<ser:getStatusResponse xmlns:ser="http://service.sunat.gob.pe"><status><statusCode>98</statusCode></status></ser:getStatusResponse>',
        ),
      );

    await expect(
      new SunatSoapClientService(config).getStatus({
        environment: Environment.BETA,
        username: '20123456789MODDATOS',
        password: 'MODDATOS',
        ticket: '202611020000123',
      }),
    ).resolves.toEqual({ statusCode: '98', cdrZip: null });
  });

  it('obtiene el CDR final al consultar el ticket', async () => {
    const cdr = Buffer.from('summary-cdr');
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        soapResponse(
          `<ser:getStatusResponse xmlns:ser="http://service.sunat.gob.pe"><status><statusCode>0</statusCode><content>${cdr.toString('base64')}</content></status></ser:getStatusResponse>`,
        ),
      );

    await expect(
      new SunatSoapClientService(config).getStatus({
        environment: Environment.BETA,
        username: '20123456789MODDATOS',
        password: 'MODDATOS',
        ticket: '202611020000123',
      }),
    ).resolves.toEqual({ statusCode: '0', cdrZip: cdr });
  });
});

function input() {
  return {
    environment: Environment.BETA,
    username: '20123456789MODDATOS',
    password: 'MODDATOS',
    fileName: 'document.zip',
    zip: Buffer.from('zip'),
  };
}

function soapResponse(content: string, status = 200) {
  return new Response(
    `<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/"><soap-env:Body>${content}</soap-env:Body></soap-env:Envelope>`,
    { status, headers: { 'Content-Type': 'text/xml' } },
  );
}
