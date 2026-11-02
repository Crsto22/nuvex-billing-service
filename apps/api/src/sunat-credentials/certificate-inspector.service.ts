import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import forge from 'node-forge';

export type CertificateMetadata = {
  fingerprint: string;
  serialNumber: string;
  subject: string;
  issuer: string;
  validFrom: Date;
  expiresAt: Date;
};

@Injectable()
export class CertificateInspectorService {
  inspect(buffer: Buffer, password: string): CertificateMetadata {
    try {
      const asn1 = forge.asn1.fromDer(buffer.toString('binary'));
      const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
      const certs =
        p12.getBags({ bagType: forge.pki.oids.certBag })[
          forge.pki.oids.certBag
        ] ?? [];
      const keys = [
        ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
          forge.pki.oids.pkcs8ShroudedKeyBag
        ] ?? []),
        ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[
          forge.pki.oids.keyBag
        ] ?? []),
      ];
      const certificate = certs
        .map((bag) => bag.cert)
        .filter((value): value is forge.pki.Certificate => Boolean(value))
        .find((candidate) =>
          keys.some(
            (bag) => bag.key && keyMatchesCertificate(bag.key, candidate),
          ),
        );
      if (!certificate) {
        throw new Error('No contiene certificado y clave privada');
      }

      const der = forge.asn1
        .toDer(forge.pki.certificateToAsn1(certificate))
        .getBytes();
      return {
        fingerprint: createHash('sha256')
          .update(Buffer.from(der, 'binary'))
          .digest('hex'),
        serialNumber: certificate.serialNumber,
        subject: distinguishedName(certificate.subject.attributes),
        issuer: distinguishedName(certificate.issuer.attributes),
        validFrom: certificate.validity.notBefore,
        expiresAt: certificate.validity.notAfter,
      };
    } catch {
      throw new BadRequestException(
        'El certificado PFX/P12, su contraseÃ±a o su clave privada no son vÃ¡lidos',
      );
    }
  }
}

function keyMatchesCertificate(
  privateKey: forge.pki.rsa.PrivateKey,
  certificate: forge.pki.Certificate,
) {
  try {
    const md = forge.md.sha256.create();
    md.update('nuvex-certificate-check', 'utf8');
    const signature = privateKey.sign(md);
    const verifyMd = forge.md.sha256.create();
    verifyMd.update('nuvex-certificate-check', 'utf8');
    return (certificate.publicKey as forge.pki.rsa.PublicKey).verify(
      verifyMd.digest().bytes(),
      signature,
    );
  } catch {
    return false;
  }
}

function distinguishedName(attributes: forge.pki.CertificateField[]) {
  return attributes
    .map(
      (attribute) =>
        `${attribute.shortName ?? attribute.name}=${String(attribute.value)}`,
    )
    .join(', ');
}
