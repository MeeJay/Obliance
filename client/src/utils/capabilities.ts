import type { Device, CommandType } from '@obliance/shared';
import { agentSupportsCommand } from '@obliance/shared';

/** Whether a device's agent build can run a given command type. Legacy
 *  (Go 1.20) agents only support the LEGACY_AGENT_COMMANDS subset; modern
 *  / unknown agents support everything. */
export function isCommandSupported(device: Pick<Device, 'agentFlavor'>, command: CommandType): boolean {
  return agentSupportsCommand(device.agentFlavor, command);
}

/** Tooltip shown on a control disabled because the device's agent build
 *  can't run the underlying command. */
export function unsupportedTooltip(t: (k: string) => string): string {
  return t('commands.unsupportedOnAgent') || 'Not supported by this agent build';
}
