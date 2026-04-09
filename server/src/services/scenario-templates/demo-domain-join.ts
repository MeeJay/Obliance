import type { ScenarioTemplate } from './index';

export const demoDomainJoin: ScenarioTemplate = {
  name: 'Demo — Active Directory Domain Join',
  description: 'Join a Windows machine to an Active Directory domain after agent approval.',
  triggerType: 'agent_approved',
  triggerConfig: {},
  targetType: 'device',
  variables: {
    DOMAIN_NAME: '',
    OU_PATH: '',
    DOMAIN_USER: '',
    DOMAIN_PASS: '',
  },
  timeoutSeconds: 300,
  steps: [
    {
      name: 'Join domain',
      description: 'Check if already joined to the target domain. If not, join and restart.',
      checkScript: {
        name: 'Check domain membership',
        platform: 'windows',
        runtime: 'powershell',
        purpose: 'check',
        content: [
          '$cs = Get-WmiObject Win32_ComputerSystem',
          'if ($cs.PartOfDomain -and $cs.Domain -eq $env:DOMAIN_NAME) { exit 0 } else { exit 1 }',
        ].join('\n'),
      },
      resolveScript: {
        name: 'Join AD domain',
        platform: 'windows',
        runtime: 'powershell',
        purpose: 'resolve',
        content: [
          '$secPass = ConvertTo-SecureString $env:DOMAIN_PASS -AsPlainText -Force',
          '$cred = New-Object PSCredential($env:DOMAIN_USER, $secPass)',
          'Add-Computer -DomainName $env:DOMAIN_NAME -OUPath $env:OU_PATH -Credential $cred -Force -Restart',
        ].join('\n'),
      },
      timeoutSeconds: 120,
      retryCount: 1,
    },
  ],
};
