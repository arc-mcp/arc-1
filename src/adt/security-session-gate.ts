/**
 * Lets one request establish the SAP security session before a cold client fans out.
 *
 * Returning the first response's cookie avoids issuing unused sessions for every
 * startup probe. See docs/research/2026-10-22-security-session-bootstrap.md.
 */

import { awaitWithinRequestBudget, type RequestDeadlineOptions, throwIfRequestCancelled } from './http-deadline.js';

/** True when one of the cookies is a SAP security session cookie (`SAP_SESSIONID_<SID>_<CLNT>`). */
export function hasSecuritySessionCookie(cookieNames: Iterable<string>): boolean {
  return [...cookieNames].some((name) => name.startsWith('SAP_SESSIONID'));
}

export class SecuritySessionGate {
  private pending: Promise<void> | undefined;
  private ready = false;
  private currentGeneration = 0;

  get generation(): number {
    return this.currentGeneration;
  }

  /**
   * Serialize only the first wire response. A rejection lets one waiter take over;
   * a real cookie-less response opens the gate for systems without security sessions.
   */
  async run<T>(
    hasSessionCookie: () => boolean,
    request: (waited: boolean) => Promise<T>,
    options?: RequestDeadlineOptions,
  ): Promise<T> {
    let waited = false;
    while (this.pending) {
      waited = true;
      await awaitWithinRequestBudget(this.pending, options);
    }
    throwIfRequestCancelled(options);
    if (this.ready || hasSessionCookie()) return request(waited);

    const generation = this.generation;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.pending = pending;
    try {
      const result = await request(waited);
      if (generation === this.generation) this.ready = true;
      return result;
    } finally {
      if (this.pending === pending) this.pending = undefined;
      release();
    }
  }

  /** Keep a pending owner until it settles, but reject its old session state. */
  reset(): void {
    this.currentGeneration++;
    this.ready = false;
  }
}
