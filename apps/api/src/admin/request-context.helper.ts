import type { RequestWithId } from '../common/request-id.middleware';

export function adminContext(request: RequestWithId) {
  return { requestId: request.requestId, ip: request.ip };
}
