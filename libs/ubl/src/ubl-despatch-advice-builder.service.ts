import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { create } from 'xmlbuilder2';

const DOCUMENT_TYPE_CODE: Record<string, string> = {
  DNI: '1',
  FOREIGN_ID: '4',
  RUC: '6',
  PASSPORT: '7',
};

type XmlNode = ReturnType<typeof create>;
type DespatchAdviceGuide = Prisma.DespatchGuideGetPayload<{
  include: {
    recipient: true;
    carrier: true;
    vehicles: true;
    drivers: true;
    items: true;
  };
}>;

type IssuerSnapshot = {
  ruc?: string;
  legalName?: string;
  tradeName?: string | null;
};

@Injectable()
export class UblDespatchAdviceBuilderService {
  build(guide: DespatchAdviceGuide) {
    const issuer = guide.issuerSnapshot as IssuerSnapshot;
    this.validate(guide, issuer);

    const root = create({ version: '1.0', encoding: 'UTF-8' }).ele(
      'DespatchAdvice',
      {
        xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2',
        'xmlns:cac':
          'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
        'xmlns:cbc':
          'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
        'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
        'xmlns:ext':
          'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
      },
    );

    root
      .ele('ext:UBLExtensions')
      .ele('ext:UBLExtension')
      .ele('ext:ExtensionContent');
    root.ele('cbc:UBLVersionID').txt('2.1');
    root.ele('cbc:CustomizationID').txt('2.0');
    root.ele('cbc:ID').txt(`${guide.series}-${guide.number}`);
    root.ele('cbc:IssueDate').txt(this.date(guide.issueDate));
    root.ele('cbc:IssueTime').txt(guide.issueTime);
    root
      .ele('cbc:DespatchAdviceTypeCode', {
        listAgencyName: 'PE:SUNAT',
        listName: 'Tipo de Documento',
        listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01',
      })
      .txt('09');

    this.appendRelatedDocument(root, guide);
    this.appendSignatureDeclaration(root, issuer);
    this.appendParty(root, 'cac:DespatchSupplierParty', {
      documentNumber: issuer.ruc!,
      documentType: '6',
      name: issuer.legalName!,
    });
    this.appendParty(root, 'cac:DeliveryCustomerParty', {
      documentNumber: guide.recipient!.documentNumber,
      documentType: DOCUMENT_TYPE_CODE[guide.recipient!.documentType],
      name: guide.recipient!.name,
    });
    this.appendShipment(root, guide);

    [...guide.items]
      .sort((left, right) => left.lineNumber - right.lineNumber)
      .forEach((item) => {
        const line = root.ele('cac:DespatchLine');
        line.ele('cbc:ID').txt(String(item.lineNumber));
        line
          .ele('cbc:DeliveredQuantity', {
            unitCode: item.unitCode,
            unitCodeListID: 'UN/ECE rec 20',
            unitCodeListAgencyName:
              'United Nations Economic Commission for Europe',
          })
          .txt(item.quantity.toFixed());
        line
          .ele('cac:OrderLineReference')
          .ele('cbc:LineID')
          .txt(String(item.lineNumber));
        const product = line.ele('cac:Item');
        product.ele('cbc:Description').txt(item.description);
        if (item.sku) {
          product
            .ele('cac:SellersItemIdentification')
            .ele('cbc:ID')
            .txt(item.sku);
        }
      });

    return root.end({ prettyPrint: false });
  }

  private appendRelatedDocument(root: XmlNode, guide: DespatchAdviceGuide) {
    if (!guide.relatedDocumentType || !guide.relatedDocumentNumber) return;
    const reference = root.ele('cac:AdditionalDocumentReference');
    reference.ele('cbc:ID').txt(guide.relatedDocumentNumber);
    reference
      .ele('cbc:DocumentTypeCode', {
        listAgencyName: 'PE:SUNAT',
        listName: 'Documento relacionado al transporte',
        listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo61',
      })
      .txt(guide.relatedDocumentType);
  }

  private appendSignatureDeclaration(root: XmlNode, issuer: IssuerSnapshot) {
    const signature = root.ele('cac:Signature');
    signature.ele('cbc:ID').txt('SIGNATURE');
    const party = signature.ele('cac:SignatoryParty');
    party.ele('cac:PartyIdentification').ele('cbc:ID').txt(issuer.ruc!);
    party
      .ele('cac:PartyName')
      .ele('cbc:Name')
      .txt(issuer.tradeName || issuer.legalName!);
    signature
      .ele('cac:DigitalSignatureAttachment')
      .ele('cac:ExternalReference')
      .ele('cbc:URI')
      .txt('#SIGNATURE');
  }

  private appendParty(
    root: XmlNode,
    nodeName: string,
    partyData: { documentNumber: string; documentType: string; name: string },
  ) {
    const party = root.ele(nodeName).ele('cac:Party');
    party
      .ele('cac:PartyIdentification')
      .ele('cbc:ID', {
        schemeID: partyData.documentType,
        schemeName: 'Documento de Identidad',
        schemeAgencyName: 'PE:SUNAT',
        schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06',
      })
      .txt(partyData.documentNumber);
    party
      .ele('cac:PartyLegalEntity')
      .ele('cbc:RegistrationName')
      .txt(partyData.name);
  }

  private appendShipment(root: XmlNode, guide: DespatchAdviceGuide) {
    const shipment = root.ele('cac:Shipment');
    shipment.ele('cbc:ID').txt('SUNAT_Envio');
    shipment
      .ele('cbc:HandlingCode', {
        listAgencyName: 'PE:SUNAT',
        listName: 'Motivo de traslado',
        listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo20',
      })
      .txt(guide.transferReasonCode);
    if (guide.transferReasonDescription) {
      shipment
        .ele('cbc:HandlingInstructions')
        .txt(guide.transferReasonDescription);
    }
    shipment
      .ele('cbc:GrossWeightMeasure', { unitCode: guide.weightUnit })
      .txt(guide.grossWeight.toFixed(3));
    if (guide.packageCount !== null) {
      shipment
        .ele('cbc:TotalTransportHandlingUnitQuantity')
        .txt(String(guide.packageCount));
    }

    const stage = shipment.ele('cac:ShipmentStage');
    stage
      .ele('cbc:TransportModeCode', {
        listAgencyName: 'PE:SUNAT',
        listName: 'Modalidad de traslado',
        listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo18',
      })
      .txt(guide.transportMode === 'PUBLIC' ? '01' : '02');
    stage
      .ele('cac:TransitPeriod')
      .ele('cbc:StartDate')
      .txt(this.date(guide.transferStartDate));

    if (guide.transportMode === 'PUBLIC') {
      this.appendCarrier(stage, guide);
      stage
        .ele('cac:LoadingTransportEvent')
        .ele('cbc:OccurrenceDate')
        .txt(this.date(guide.carrierDeliveryDate!));
    } else {
      [...guide.drivers]
        .sort((left, right) => Number(right.primary) - Number(left.primary))
        .forEach((driver) => this.appendDriver(stage, driver));
    }

    const delivery = shipment.ele('cac:Delivery');
    if (guide.arrivalUbigeo && guide.arrivalAddress) {
      this.appendAddress(
        delivery,
        'cac:DeliveryAddress',
        guide.arrivalUbigeo,
        guide.arrivalAddress,
      );
    }
    const despatch = delivery.ele('cac:Despatch');
    this.appendAddress(
      despatch,
      'cac:DespatchAddress',
      guide.departureUbigeo,
      guide.departureAddress,
    );

    if (guide.transportMode === 'PRIVATE') {
      this.appendVehicles(shipment, guide);
    }
  }

  private appendCarrier(stage: XmlNode, guide: DespatchAdviceGuide) {
    const carrier = stage.ele('cac:CarrierParty');
    carrier
      .ele('cac:PartyIdentification')
      .ele('cbc:ID', {
        schemeID: '6',
        schemeName: 'Documento de Identidad',
        schemeAgencyName: 'PE:SUNAT',
        schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06',
      })
      .txt(guide.carrier!.ruc);
    const legal = carrier.ele('cac:PartyLegalEntity');
    legal.ele('cbc:RegistrationName').txt(guide.carrier!.legalName);
    if (guide.carrier!.mtcRegistrationNumber) {
      legal.ele('cbc:CompanyID').txt(guide.carrier!.mtcRegistrationNumber);
    }
  }

  private appendDriver(
    stage: XmlNode,
    driver: DespatchAdviceGuide['drivers'][number],
  ) {
    const person = stage.ele('cac:DriverPerson');
    person
      .ele('cbc:ID', {
        schemeID: DOCUMENT_TYPE_CODE[driver.documentType],
        schemeName: 'Documento de Identidad',
        schemeAgencyName: 'PE:SUNAT',
        schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06',
      })
      .txt(driver.documentNumber);
    person.ele('cbc:FirstName').txt(driver.firstNames);
    person.ele('cbc:FamilyName').txt(driver.lastNames);
    person.ele('cbc:JobTitle').txt(driver.primary ? 'Principal' : 'Secundario');
    person
      .ele('cac:IdentityDocumentReference')
      .ele('cbc:ID')
      .txt(driver.licenseNumber);
  }

  private appendVehicles(root: XmlNode, guide: DespatchAdviceGuide) {
    const unit = root.ele('cac:TransportHandlingUnit');
    const ordered = [...guide.vehicles].sort(
      (left, right) => Number(right.primary) - Number(left.primary),
    );
    const primary = unit.ele('cac:TransportEquipment');
    this.appendVehicle(primary, ordered[0]);
    ordered.slice(1).forEach((vehicle) => {
      this.appendVehicle(
        primary.ele('cac:AttachedTransportEquipment'),
        vehicle,
      );
    });
  }

  private appendVehicle(
    equipment: XmlNode,
    vehicle: DespatchAdviceGuide['vehicles'][number],
  ) {
    equipment.ele('cbc:ID').txt(vehicle.plate);
    if (vehicle.authorizationNumber) {
      equipment
        .ele('cac:ApplicableTransportMeans')
        .ele('cbc:RegistrationNationalityID')
        .txt(vehicle.authorizationNumber);
    }
  }

  private appendAddress(
    parent: XmlNode,
    nodeName: string,
    ubigeo: string,
    address: string,
  ) {
    const node = parent.ele(nodeName);
    node
      .ele('cbc:ID', { schemeName: 'Ubigeos', schemeAgencyName: 'PE:INEI' })
      .txt(ubigeo);
    node.ele('cac:AddressLine').ele('cbc:Line').txt(address);
  }

  private validate(guide: DespatchAdviceGuide, issuer: IssuerSnapshot) {
    if (!issuer.ruc || !/^\d{11}$/.test(issuer.ruc) || !issuer.legalName) {
      throw new BadRequestException('El emisor de la GRE no es válido');
    }
    if (!/^T[A-Z0-9]{3}$/.test(guide.series)) {
      throw new BadRequestException('La serie GRE debe tener formato T###');
    }
    if (!/^\d{2}:\d{2}:\d{2}$/.test(guide.issueTime)) {
      throw new BadRequestException(
        'La hora de emisión de la GRE no es válida',
      );
    }
    if (!guide.recipient) {
      throw new BadRequestException('La GRE requiere destinatario');
    }
    if (!DOCUMENT_TYPE_CODE[guide.recipient.documentType]) {
      throw new BadRequestException('Documento del destinatario no soportado');
    }
    if (!guide.items.length) {
      throw new BadRequestException('La GRE requiere bienes transportados');
    }
    if (guide.items.some((item) => item.sku && item.sku.length > 30)) {
      throw new BadRequestException(
        'El código de producto SUNAT admite hasta 30 caracteres',
      );
    }
    if (
      guide.transportMode === 'PUBLIC' &&
      (!guide.carrier || !guide.carrierDeliveryDate)
    ) {
      throw new BadRequestException(
        'El transporte público requiere transportista y fecha de entrega',
      );
    }
    if (guide.transportMode === 'PRIVATE') {
      if (!guide.vehicles.length || !guide.drivers.length) {
        throw new BadRequestException(
          'El transporte privado requiere vehículo y conductor',
        );
      }
      if (
        guide.drivers.some((driver) => !DOCUMENT_TYPE_CODE[driver.documentType])
      ) {
        throw new BadRequestException('Documento de conductor no soportado');
      }
    }
  }

  private date(value: Date) {
    return value.toISOString().slice(0, 10);
  }
}
