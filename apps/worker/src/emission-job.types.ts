export interface ClaimedEmissionJob {
  id: string;
  documentId: string;
  operation: 'ISSUE';
  attempts: number;
  maxAttempts: number;
}

export interface JobFailure {
  code: string;
  message: string;
  retryable: boolean;
}
