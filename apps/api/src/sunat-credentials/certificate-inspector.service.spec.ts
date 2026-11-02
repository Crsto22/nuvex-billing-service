import { BadRequestException } from '@nestjs/common';
import forge from 'node-forge';
import { CertificateInspectorService } from './certificate-inspector.service';

describe('CertificateInspectorService', () => {
  const service = new CertificateInspectorService();

  it('extracts metadata and verifies that the private key matches', () => {
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const certificate = forge.pki.createCertificate();
    certificate.publicKey = keys.publicKey;
    certificate.serialNumber = '01ab';
    certificate.validity.notBefore = new Date(Date.now() - 60_000);
    certificate.validity.notAfter = new Date(Date.now() + 86_400_000);
    const attributes = [{ name: 'commonName', value: 'Nuvex Test' }];
    certificate.setSubject(attributes);
    certificate.setIssuer(attributes);
    certificate.sign(keys.privateKey, forge.md.sha256.create());
    const password = 'test-password';
    const p12 = forge.pkcs12.toPkcs12Asn1(
      keys.privateKey,
      [certificate],
      password,
    );
    const buffer = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');

    const result = service.inspect(buffer, password);

    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.serialNumber).toBe('01ab');
    expect(result.subject).toContain('Nuvex Test');
  });

  it('rejects an invalid password without leaking its value', () => {
    expect(() =>
      service.inspect(Buffer.from('invalid'), 'secret-value'),
    ).toThrow(BadRequestException);
    try {
      service.inspect(Buffer.from('invalid'), 'secret-value');
    } catch (error) {
      expect(String(error)).not.toContain('secret-value');
    }
  });
});
