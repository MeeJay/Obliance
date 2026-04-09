import type { ScenarioTemplate } from './index';

export const demoInstallSoftware: ScenarioTemplate = {
  name: 'Demo — Install Software via Winget',
  description: 'Install a software package via winget on Windows machines.',
  triggerType: 'manual',
  triggerConfig: {},
  targetType: 'device',
  variables: {
    WINGET_PACKAGE_ID: 'Mozilla.Firefox',
  },
  timeoutSeconds: 600,
  steps: [
    {
      name: 'Install package',
      description: 'Check if the package is already installed. If not, install it via winget.',
      checkScript: {
        name: 'Check package installed',
        platform: 'windows',
        runtime: 'powershell',
        purpose: 'check',
        content: [
          '$result = winget list --id $env:WINGET_PACKAGE_ID --accept-source-agreements 2>&1',
          'if ($LASTEXITCODE -eq 0 -and $result -match $env:WINGET_PACKAGE_ID) { exit 0 } else { exit 1 }',
        ].join('\n'),
      },
      resolveScript: {
        name: 'Install via winget',
        platform: 'windows',
        runtime: 'powershell',
        purpose: 'resolve',
        content: [
          'winget install --id $env:WINGET_PACKAGE_ID --accept-package-agreements --accept-source-agreements --silent',
        ].join('\n'),
      },
      timeoutSeconds: 300,
      retryCount: 1,
    },
    {
      name: 'Verify installation',
      description: 'Confirm the package is now installed.',
      checkScript: {
        name: 'Verify package installed',
        platform: 'windows',
        runtime: 'powershell',
        purpose: 'check',
        content: [
          '$result = winget list --id $env:WINGET_PACKAGE_ID --accept-source-agreements 2>&1',
          'if ($LASTEXITCODE -eq 0 -and $result -match $env:WINGET_PACKAGE_ID) { exit 0 } else { exit 1 }',
        ].join('\n'),
      },
      resolveScript: null,
      timeoutSeconds: 60,
      retryCount: 2,
    },
  ],
};
