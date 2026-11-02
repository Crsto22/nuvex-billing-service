import { DOMParser } from '@xmldom/xmldom';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { XmlSignatureService } from './xml-signature.service';

describe('XmlSignatureService', () => {
  it('firma el nodo raiz y la firma resultante es verificable', () => {
    const { pfx, certificatePem } = certificateFixture('secret');
    const service = new XmlSignatureService();
    const result = service.sign(
      '<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions></Invoice>',
      pfx,
      'secret',
    );
    const document = new DOMParser().parseFromString(
      result.xml,
      'application/xml',
    );
    const signatureNode = document.getElementsByTagName('ds:Signature').item(0);
    expect(signatureNode).not.toBeNull();
    expect(result.digestValue).toBeTruthy();

    const verifier = new SignedXml({ publicCert: certificatePem });
    verifier.loadSignature(signatureNode!);
    expect(verifier.checkSignature(result.xml)).toBe(true);
  });

  it('firma la raiz SummaryDocuments del Resumen Diario', () => {
    const { pfx } = certificateFixture('secret');
    const result = new XmlSignatureService().sign(
      '<?xml version="1.0"?><SummaryDocuments xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions></SummaryDocuments>',
      pfx,
      'secret',
      'SummaryDocuments',
    );

    expect(result.xml).toContain('<ds:Signature');
    expect(result.digestValue).toBeTruthy();
  });
});

function certificateFixture(password: string) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date('2025-01-01T00:00:00Z');
  certificate.validity.notAfter = new Date('2030-01-01T00:00:00Z');
  const attributes = [{ name: 'commonName', value: 'Nuvex Test' }];
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(
    keys.privateKey,
    [certificate],
    password,
    { algorithm: '3des' },
  );
  return {
    pfx: Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary'),
    certificatePem: forge.pki.certificateToPem(certificate),
  };
}
