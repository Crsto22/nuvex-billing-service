import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SunatDailySummaryService } from '../../../libs/sunat/src/sunat-daily-summary.service';
import { SunatVoidJobProcessorService } from './sunat-void-job-processor.service';
import { SunatVoidJobRepository } from './sunat-void-job.repository';
import { ClaimedSunatVoidJob } from './sunat-void-job.types';

describe('SunatVoidJobProcessorService', () => {
  const job: ClaimedSunatVoidJob = {
    id: 'void-job-1',
    voidRequestId: 'void-request-1',
    attempts: 1,
    maxAttempts: 20,
  };

  function setup(error?: Error) {
    const repository = {
      heartbeat: jest.fn().mockResolvedValue(true),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(false),
    };
    const summaries = {
      submitVoidRequest: error
        ? jest.fn().mockRejectedValue(error)
        : jest.fn().mockResolvedValue({ status: 'ACCEPTED' }),
    };
    const config = {
      getOrThrow: jest.fn((key: string) =>
        key === 'WORKER_LOCK_TIMEOUT_MS'
          ? 120_000
          : key === 'WORKER_RETRY_BASE_MS'
            ? 5_000
            : 900_000,
      ),
    };
    const service = new SunatVoidJobProcessorService(
      config as unknown as ConfigService,
      repository as unknown as SunatVoidJobRepository,
      summaries as unknown as SunatDailySummaryService,
    );
    return { service, repository, summaries };
  }

  it('completa el trabajo cuando SUNAT entrega el CDR', async () => {
    const { service, repository, summaries } = setup();

    await service.process(job, 'worker-1');

    expect(summaries.submitVoidRequest).toHaveBeenCalledWith('void-request-1');
    expect(repository.complete).toHaveBeenCalledWith(job, 'worker-1');
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('reprograma la consulta cuando el ticket sigue procesando', async () => {
    const { service, repository } = setup(
      new ServiceUnavailableException('SUNAT aun procesa el ticket'),
    );

    await service.process(job, 'worker-1');

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(
      job,
      'worker-1',
      expect.objectContaining({ code: 'HTTP_503', retryable: true }),
      expect.any(Date),
    );
  });
});
