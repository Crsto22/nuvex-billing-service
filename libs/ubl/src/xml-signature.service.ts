import { BadRequestException, Injectable } from '@nestjs/common';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

@Injectable()
export class XmlSignatureService {
  sign(xml: string, pfx: Buffer, password: string, rootLocalName = 'Invoice') {
    const { privateKeyPem, certificatePem } = this.extract(pfx, password);
    const certificate = certificatePem.replace(
      /-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g,
      '',
    );
    const signature = new SignedXml({
      privateKey: privateKeyPem,
      publicCert: certificatePem,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
      getKeyInfoContent: (args) => {
        const prefix = args?.prefix ? `${args.prefix}:` : '';
        return `<${prefix}X509Data><${prefix}X509Certificate>${certificate}</${prefix}X509Certificate></${prefix}X509Data>`;
      },
    });
    signature.addReference({
      xpath: `//*[local-name(.)='${rootLocalName}']`,
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#',
      ],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
      uri: '',
      isEmptyUri: true,
    });
    signature.computeSignature(xml, {
      prefix: 'ds',
      attrs: { Id: 'SIGNATURE' },
      location: {
        reference: "//*[local-name(.)='ExtensionContent']",
        action: 'append',
      },
    });
    const signedXml = signature.getSignedXml();
    const digestValue = signedXml.match(
      /<ds:DigestValue>([^<]+)<\/ds:DigestValue>/,
    )?.[1];
    if (!digestValue) {
      throw new BadRequestException('No se pudo obtener el digest del XML');
    }
    return { xml: signedXml, bytes: Buffer.from(signedXml), digestValue };
  }

  private extract(buffer: Buffer, password: string) {
    try {
      const asn1 = forge.asn1.fromDer(buffer.toString('binary'));
      const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
      const keyBag =
        p12
          .getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
          [forge.pki.oids.pkcs8ShroudedKeyBag]?.find((bag) => bag.key) ??
        p12
          .getBags({ bagType: forge.pki.oids.keyBag })
          [forge.pki.oids.keyBag]?.find((bag) => bag.key);
      const certificates = p12.getBags({ bagType: forge.pki.oids.certBag })[
        forge.pki.oids.certBag
      ];
      if (!keyBag?.key || !certificates?.length) throw new Error('incompleto');

      const publicKey = forge.pki.setRsaPublicKey(keyBag.key.n, keyBag.key.e);
      const certificate = certificates.find(
        (bag) =>
          bag.cert &&
          forge.pki.publicKeyToPem(bag.cert.publicKey) ===
            forge.pki.publicKeyToPem(publicKey),
      )?.cert;
      if (!certificate) throw new Error('sin certificado asociado');

      return {
        privateKeyPem: forge.pki.privateKeyToPem(keyBag.key),
        certificatePem: forge.pki.certificateToPem(certificate),
      };
    } catch {
      throw new BadRequestException(
        'No se pudo abrir el certificado SUNAT o la clave privada no coincide',
      );
    }
  }
}
