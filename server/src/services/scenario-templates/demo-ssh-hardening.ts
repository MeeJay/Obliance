import type { ScenarioTemplate } from './index';

export const demoSshHardening: ScenarioTemplate = {
  name: 'Demo — Linux SSH Hardening',
  description: 'Harden SSH configuration on Linux servers: disable root login, enforce key auth.',
  triggerType: 'manual',
  triggerConfig: {},
  targetType: 'device',
  variables: {},
  timeoutSeconds: 120,
  steps: [
    {
      name: 'Disable root login',
      description: 'Ensure PermitRootLogin is set to no in sshd_config.',
      checkScript: {
        name: 'Check root login disabled',
        platform: 'linux',
        runtime: 'bash',
        purpose: 'check',
        content: 'grep -q "^PermitRootLogin no" /etc/ssh/sshd_config && exit 0 || exit 1',
      },
      resolveScript: {
        name: 'Disable root login',
        platform: 'linux',
        runtime: 'bash',
        purpose: 'resolve',
        content: 'sed -i \'s/^#*PermitRootLogin.*/PermitRootLogin no/\' /etc/ssh/sshd_config && systemctl restart sshd',
      },
      timeoutSeconds: 30,
      retryCount: 0,
    },
    {
      name: 'Disable password authentication',
      description: 'Ensure PasswordAuthentication is set to no in sshd_config.',
      checkScript: {
        name: 'Check password auth disabled',
        platform: 'linux',
        runtime: 'bash',
        purpose: 'check',
        content: 'grep -q "^PasswordAuthentication no" /etc/ssh/sshd_config && exit 0 || exit 1',
      },
      resolveScript: {
        name: 'Disable password auth',
        platform: 'linux',
        runtime: 'bash',
        purpose: 'resolve',
        content: 'sed -i \'s/^#*PasswordAuthentication.*/PasswordAuthentication no/\' /etc/ssh/sshd_config && systemctl restart sshd',
      },
      timeoutSeconds: 30,
      retryCount: 0,
    },
  ],
};
