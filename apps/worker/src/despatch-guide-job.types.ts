export interface ClaimedDespatchGuideJob {
  id: string;
  guideId: string;
  attempts: number;
  maxAttempts: number;
}
