/**
 * Background scenarios (B1-B10, C11): the host puts the app in the background (adb), the SDK pauses and resumes; what
 * the app does is answer commands there (over the XHR link) and show the call service's state. The provider starts
 * the service on the join when the manifest declares it; `callService stop` turns the providers' `callService` prop
 * off (the SDK then stops it) and `start` turns it back on.
 */
import type { Handler } from '../commands';
import { RunnerError, waitUntil } from '../registry';

export const background: Record<string, Handler> = {
  async callService(args, ctx) {
    const action = args.action ?? 'state';
    if (action !== 'state' && action !== 'start' && action !== 'stop') throw new RunnerError('bad-params', 'action must be state, start or stop');
    if (action !== 'state') {
      const wanted = action === 'start';
      ctx.control.setCallServiceOn(wanted);
      const live = Object.values(ctx.registry.handles).some((h) => h.connected && !h.closed);
      // A start takes effect only while a call is live; a stop always ends the service.
      if (!wanted || live) await waitUntil(() => ctx.registry.callService().running === wanted, 3000, `call service ${action}`).catch(() => undefined);
    }
    return ctx.registry.callService();
  },
};
