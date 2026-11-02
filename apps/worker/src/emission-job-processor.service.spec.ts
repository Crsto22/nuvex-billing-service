import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UblArtifactService } from '../../../libs/ubl/src/ubl-artifact.service';
import { SunatSubmissionService } from '../../../libs/sunat/src/sunat-submission.service';
import { PdfArtifactService } from '../../../libs/pdf/src/pdf-artifact.service';
import {
  classifyJobError,
  EmissionJobProcessorService,
  retryDelayMs,
} from './emission-job-processor.service';
import { EmissionJobRepository } from './emission-job.repository';
import { ClaimedEmissionJob } from './emission-job.types';

describe('EmissionJobProcessorService', () => {
  const job: ClaimedEmissionJob = {
    id: 'job-1',
    documentId: 'document-1',
    operation: 'ISSUE',
    attempts: 1,
    maxAttempts: 10,
  };

  function setup(error?: Error, sunatStatus = 'ACCEPTED') {
    const repository = {
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(false),
      heartbeat: jest.fn().mockResolvedValue(true),
    };
    const artifacts = {
      generate: error
        ? jest.fn().mockRejectedValue(error)
        : jest.fn().mockResolvedValue({}),
    };
    const sunat = {
      submit: jest.fn().mockResolvedValue({ status: sunatStatus }),
    };
    const pdf = { generate: jest.fn().mockResolvedValue({}) };
    const config = {
      getOrThrow: jest.fn((key: string) =>
        key === 'WORKER_LOCK_TIMEOUT_MS'
          ? 120_000
          : key === 'WORKER_RETRY_BASE_MS'
            ? 5_000
            : 900_000,
      ),
    };
    const service = new EmissionJobProcessorService(
      config as unknown as ConfigService,
      repository as unknown as EmissionJobRepository,
      artifacts as unknown as UblArtifactService,
      sunat as unknown as SunatSubmissionService,
      pdf as unknown as PdfArtifactService,
    );
    return { service, repository, artifacts, sunat, pdf };
  }

  it('genera artefactos y completa el trabajo que aun posee', async () => {
    const { service, repository, artifacts, sunat, pdf } = setup();

    await service.process(job, 'worker-1');

    expect(artifacts.generate).toHaveBeenCalledWith('document-1');
    expect(sunat.submit).toHaveBeenCalledWith('document-1');
    expect(pdf.generate).toHaveBeenCalledWith('document-1');
    expect(repository.complete).toHaveBeenCalledWith(job, 'worker-1');
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('no genera representación impresa para un comprobante rechazado', async () => {
    const { service, repository, pdf } = setup(undefined, 'REJECTED');

    await service.process(job, 'worker-1');

    expect(pdf.generate).not.toHaveBeenCalled();
    expect(repository.complete).toHaveBeenCalledWith(job, 'worker-1');
  });

  it('reprograma un error transitorio con una fecha futura', async () => {
    const { service, repository } = setup(
      new ServiceUnavailableException('R2 no disponible'),
    );

    await service.process(job, 'worker-1');

    expect(repository.fail).toHaveBeenCalledWith(
      job,
      'worker-1',
      expect.objectContaining({ retryable: true, code: 'HTTP_503' }),
      expect.any(Date),
    );
  });

  it('marca como permanente un certificado o documento invalido', async () => {
    const { service, repository } = setup(
      new BadRequestException('Certificado invalido'),
    );

    await service.process(job, 'worker-1');

    expect(repository.fail).toHaveBeenCalledWith(
      job,
      'worker-1',
      expect.objectContaining({ retryable: false, code: 'HTTP_400' }),
      null,
    );
  });
});

describe('politica de reintentos', () => {
  it('aplica backoff exponencial, jitter y limite maximo', () => {
    const first = retryDelayMs(1, 5_000, 900_000, () => 0.5);
    const cappedLow = retryDelayMs(20, 5_000, 900_000, () => 0);
    const cappedHigh = retryDelayMs(20, 5_000, 900_000, () => 1);

    expect(first).toBe(5_000);
    expect(cappedLow).toBe(675_000);
    expect(cappedHigh).toBe(900_000);
  });

  it('limpia saltos de linea de errores inesperados', () => {
    expect(classifyJobError(new Error('uno\ndos'))).toEqual({
      code: 'UNEXPECTED_ERROR',
      message: 'uno dos',
      retryable: true,
    });
  });
});
