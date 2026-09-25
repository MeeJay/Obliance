import type { TFunction } from 'i18next';
import type { RemoteProtocol, RemoteSession } from '@obliance/shared';
import { apiErrorMessage } from '@/api/sshBastion.api';

/**
 * Client-side rules matching the server's remote-tunnel security (S2):
 *   - the relay token (`sessionToken`) is only sent to the user who started
 *     the session (GET /remote/sessions and socket events strip it for
 *     everyone else), and the tunnel refuses any other user anyway;
 *   - so the UI only offers "View" / "Open" on sessions the current user
 *     started, and never opens a tunnel or adds a shell tab without a token.
 */

/** True when `userId` started this session and the client holds its relay token. */
export function canAttachRemoteSession(
  session: Pick<RemoteSession, 'startedBy'> & { sessionToken?: string | null } | null | undefined,
  userId: number | null | undefined,
): boolean {
  if (!session || userId == null || session.startedBy == null) return false;
  return !!session.sessionToken && Number(session.startedBy) === Number(userId);
}

/** Thrown when a freshly started session comes back without its relay token. */
export class MissingSessionTokenError extends Error {
  constructor() {
    super('Remote session has no relay token');
    this.name = 'MissingSessionTokenError';
  }
}

/**
 * Return the session's relay token, or throw MissingSessionTokenError.
 * Use it right after `remoteApi.startSession` (and in viewer `onReconnect`
 * callbacks: a throw there stops the viewer's auto-reconnect loop).
 */
export function requireSessionToken(session: { sessionToken?: string | null } | null | undefined): string {
  const token = session?.sessionToken;
  if (!token) throw new MissingSessionTokenError();
  return token;
}

/**
 * Message to toast for a failed `remoteApi.startSession`, or null when the
 * api client interceptor already showed one (401/403/423 with a server
 * message). A 409 on the VM console means the host agent is not connected.
 */
export function remoteStartErrorMessage(
  err: unknown,
  t: TFunction,
  fallback: string,
  protocol?: RemoteProtocol,
): string | null {
  if (err instanceof MissingSessionTokenError) {
    return t('remoteSessions.noToken', 'The server did not return a connection token for this session.');
  }
  const response = (err as { response?: { status?: number; data?: { error?: unknown } } } | null)?.response;
  const serverMsg = typeof response?.data?.error === 'string' ? response.data.error : '';
  // The other 409 of POST /remote/sessions (legacy agent) keeps its own message.
  if (response?.status === 409 && protocol === 'vmconsole' && !/legacy/i.test(serverMsg)) {
    return t('hyperv.consoleHostUnreachable', 'The host agent is not connected — the VM console needs a live agent connection.');
  }
  return apiErrorMessage(err, fallback);
}
