export const WEBHOOK_EVENT_TYPES = [
  'document.processing',
  'document.accepted',
  'document.accepted_with_observations',
  'document.rejected',
  'document.retry_scheduled',
  'document.failed',
  'despatch_guide.processing',
  'despatch_guide.beta_validated',
  'despatch_guide.accepted',
  'despatch_guide.accepted_with_observations',
  'despatch_guide.rejected',
  'despatch_guide.failed',
  'sunat_void.manual_action_required',
  'sunat_void.accepted',
  'sunat_void.rejected',
  'sunat_void.failed',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export interface ClaimedWebhookDelivery {
  id: string;
  eventId: string;
  endpointId: string;
  applicationId: string;
  url: string;
  signingSecretEncrypted: string;
  eventType: WebhookEventType;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}
