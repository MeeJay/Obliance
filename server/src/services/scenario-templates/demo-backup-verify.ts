import type { ScenarioTemplate } from './index';

export const demoBackupVerify: ScenarioTemplate = {
  name: 'Demo — Verify Backup Agent Running',
  description: 'Verify that a backup agent (Veeam, Acronis, or custom) is installed and running.',
  triggerType: 'manual',
  triggerConfig: {},
  targetType: 'device',
  variables: {
    BACKUP_SERVICE_NAME: 'VeeamBackupSvc',
  },
  timeoutSeconds: 60,
  steps: [
    {
      name: 'Check backup service',
      description: 'Verify the backup service exists and is in Running state. No resolve action — alert only.',
      checkScript: {
        name: 'Check backup service running',
        platform: 'windows',
        runtime: 'powershell',
        purpose: 'check',
        content: [
          '$svc = Get-Service $env:BACKUP_SERVICE_NAME -ErrorAction SilentlyContinue',
          'if ($svc -and $svc.Status -eq \'Running\') { exit 0 } else { exit 1 }',
        ].join('\n'),
      },
      resolveScript: null,
      timeoutSeconds: 30,
      retryCount: 0,
    },
  ],
};
