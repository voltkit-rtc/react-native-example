/**
 * One launch of the in-app runner: hello, /config, then the command loop (GET /next long polls, each command run
 * through src/e2e/commands.ts, its answer posted as a `result` event) until the host answers 410 or the runner is
 * unmounted. Commands run as they arrive, without waiting for one another: the host starts a publish and acts (a
 * permission dialog, HOME) before collecting the answer.
 *
 * Nothing here uses a JS timer: polls are XHRs, pauses are the SDK's native timers (registry.ts delay()).
 */
import { Platform } from 'react-native';
import { reactNativePlatform, SDK_VERSION } from '@voltkit-rtc/react-native';
import pkg from '../../package.json';
import { execute, type CommandContext } from './commands';
import { GoneError, HostLink } from './link';
import type { Launch } from './protocol';
import { delay, type Registry, type RunnerControl } from './registry';
import { Reporter } from './report';

export interface Session {
  stop(): void;
}

const noop = () => undefined;

export function startSession(launch: Launch, registry: Registry, control: RunnerControl): Session {
  const link = new HostLink(launch.host, launch.run);
  const reporter = new Reporter(link, launch.run);
  registry.reporter = reporter;
  const ctx: CommandContext = { launch, link, reporter, registry, control, config: null };
  let stopped = false;
  const stop = () => {
    stopped = true;
    reporter.stop();
  };
  reporter.onGone = stop;

  // The native side, through the platform the SDK gives every client: visibility and the network.
  const platform = reactNativePlatform();
  const offs: (() => void)[] = [];
  const subscribe = (unsubscribe: unknown) => {
    if (typeof unsubscribe === 'function') offs.push(unsubscribe as () => void);
  };
  try {
    subscribe(platform.onAppVisibility?.((visible) => reporter.native('appVisibility', { visible })));
    subscribe(
      platform.onOnline?.(() => {
        reporter.native('networkAvailable', {});
        // A poll sent before the network went away may be stranded on the old handle: poll again on the new one now.
        link.abortPoll();
      }),
    );
  } catch (err) {
    reporter.log('warn', `platform listeners: ${String((err as Error)?.message ?? err)}`);
  }

  void (async () => {
    reporter.event('hello', {
      scenario: launch.scenario,
      app: { version: pkg.version, rnSdk: SDK_VERSION, os: Platform.OS, api: Platform.Version, hermes: typeof (globalThis as { HermesInternal?: unknown }).HermesInternal === 'object' },
    });
    for (let attempt = 0; attempt < 10 && !ctx.config && !stopped; attempt++) {
      try {
        ctx.config = await link.config();
      } catch (err) {
        if (err instanceof GoneError) {
          stop();
          break;
        }
        reporter.log('warn', `config: ${String((err as Error)?.message ?? err)}`);
        await delay(500);
      }
    }
    while (!stopped) {
      let command: Awaited<ReturnType<HostLink['next']>>;
      try {
        command = await link.next();
      } catch (err) {
        // The host is unreachable (the network is off, or the app lost its sockets in the background): try again soon.
        // A poll this launch cut itself (abortPoll: the network is back) is polled again at once.
        if (!/^aborted:/.test(String((err as Error)?.message ?? ''))) await delay(1000);
        continue;
      }
      if (command === 'gone') break;
      if (!command) continue;
      const { id, cmd, args } = command;
      void execute(cmd, args, ctx).then(
        (result) => reporter.result(id, true, result),
        (error) => reporter.result(id, false, error),
      );
    }
    reporter.stop();
  })();

  return {
    stop() {
      stop();
      for (const off of offs) {
        try {
          off();
        } catch {
          noop();
        }
      }
    },
  };
}
