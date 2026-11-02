export interface ClaimedSunatVoidJob {
  id: string;
  voidRequestId: string;
  attempts: number;
  maxAttempts: number;
}
