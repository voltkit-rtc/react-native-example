/**
 * The in-app runner's vocabulary: every command in scripts/test/rn-e2e/scenarios.mjs APP_COMMANDS, implemented in
 * src/e2e/scenarios/* (one file per scenario group) through the SDK's public API, and dispatched here.
 */
import type { HostLink, RunConfig } from './link';
import type { Launch } from './protocol';
import { RunnerError, type Registry, type RunnerControl } from './registry';
import type { Reporter } from './report';
import { background } from './scenarios/background';
import { connection } from './scenarios/connection';
import { devices } from './scenarios/devices';
import { host } from './scenarios/host';
import { publishing } from './scenarios/publishing';
import { receiving } from './scenarios/receiving';
import { room } from './scenarios/room';
import { tokens } from './scenarios/tokens';

export interface CommandContext {
  launch: Launch;
  link: HostLink;
  reporter: Reporter;
  registry: Registry;
  control: RunnerControl;
  /** GET /config, once it answered. */
  config: RunConfig | null;
}

export type Args = Record<string, unknown>;
export type Handler = (args: Args, ctx: CommandContext) => Promise<unknown>;

export const COMMANDS: Readonly<Record<string, Handler>> = Object.freeze({
  ...connection,
  ...tokens,
  ...publishing,
  ...devices,
  ...background,
  ...receiving,
  ...room,
  ...host,
});

/** Runs one command; a refusal is an error with a code the host matches (`expectError`). */
export function execute(cmd: string, args: unknown, ctx: CommandContext): Promise<unknown> {
  const handler = COMMANDS[cmd];
  if (!handler) return Promise.reject(new RunnerError('bad-params', `unknown command "${cmd}"; the runner knows ${Object.keys(COMMANDS).join(', ')}`));
  const safeArgs: Args = args && typeof args === 'object' && !Array.isArray(args) ? (args as Args) : {};
  return handler(safeArgs, ctx);
}
