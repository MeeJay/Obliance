import type { ScriptPlatform, ScriptRuntime, ScriptPurpose, ScenarioTriggerType } from '@obliance/shared';

// ── Template types ─────────────────────────────────────────────────────────

export interface ScenarioTemplateScript {
  name: string;
  platform: ScriptPlatform;
  runtime: ScriptRuntime;
  purpose: ScriptPurpose;
  content: string;
}

export interface ScenarioTemplateStep {
  name: string;
  description: string;
  checkScript: ScenarioTemplateScript | null;
  resolveScript: ScenarioTemplateScript | null;
  timeoutSeconds: number;
  retryCount: number;
}

export interface ScenarioTemplate {
  name: string;
  description: string;
  triggerType: ScenarioTriggerType;
  triggerConfig: Record<string, any>;
  targetType: string;
  variables: Record<string, string>;
  timeoutSeconds: number;
  steps: ScenarioTemplateStep[];
}

// ── Import all templates ───────────────────────────────────────────────────

import { deployObliviewWindows } from './deploy-obliview-windows';
import { deployObliviewUnix } from './deploy-obliview-unix';
import { deployOblimapWindows } from './deploy-oblimap-windows';
import { deployOblimapUnix } from './deploy-oblimap-unix';
import { deployObliguardWindows } from './deploy-obliguard-windows';
import { deployObliguardUnix } from './deploy-obliguard-unix';

export const scenarioTemplates: ScenarioTemplate[] = [
  deployObliviewWindows,
  deployObliviewUnix,
  deployOblimapWindows,
  deployOblimapUnix,
  deployObliguardWindows,
  deployObliguardUnix,
];

export {
  deployObliviewWindows,
  deployObliviewUnix,
  deployOblimapWindows,
  deployOblimapUnix,
  deployObliguardWindows,
  deployObliguardUnix,
};
