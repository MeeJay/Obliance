import type { ScenarioTemplate } from './index';

export const demoKioskChrome: ScenarioTemplate = {
  name: 'Demo — Chrome Kiosk Mode',
  description: 'Launch Chrome in kiosk mode on user login. Ensures Chrome stays running.',
  triggerType: 'session_login',
  triggerConfig: {},
  targetType: 'device',
  variables: {
    KIOSK_URL: 'https://dashboard.example.com',
  },
  timeoutSeconds: 120,
  steps: [
    {
      name: 'Ensure Chrome kiosk is running',
      description: 'Check if Chrome is running in kiosk mode. If not, launch it.',
      checkScript: {
        name: 'Check Chrome kiosk running',
        platform: 'windows',
        runtime: 'powershell',
        purpose: 'check',
        content: [
          'Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like \'*--kiosk*\' }',
          'if ($?) { exit 0 } else { exit 1 }',
        ].join('\n'),
      },
      resolveScript: {
        name: 'Launch Chrome kiosk',
        platform: 'windows',
        runtime: 'powershell',
        purpose: 'resolve',
        content: [
          'Start-Process "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" -ArgumentList "--kiosk $env:KIOSK_URL --no-first-run" -WindowStyle Normal',
        ].join('\n'),
      },
      timeoutSeconds: 60,
      retryCount: 1,
    },
  ],
};
