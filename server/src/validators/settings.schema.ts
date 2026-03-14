import { z } from 'zod';
import { SETTINGS_KEYS } from '@obliance/shared';

const settingsKeyValues = Object.values(SETTINGS_KEYS) as [string, ...string[]];

export const setSettingSchema = z.object({
  key: z.enum(settingsKeyValues),
  value: z.number(),
});

export const setSettingsBulkSchema = z.object({
  overrides: z.array(
    z.object({
      key: z.enum(settingsKeyValues),
      value: z.number(),
    }),
  ),
});

export const deleteSettingSchema = z.object({
  key: z.enum(settingsKeyValues),
});

export type SetSettingInput = z.infer<typeof setSettingSchema>;
export type SetSettingsBulkInput = z.infer<typeof setSettingsBulkSchema>;
export type DeleteSettingInput = z.infer<typeof deleteSettingSchema>;
