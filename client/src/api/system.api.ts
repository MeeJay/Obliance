export interface SystemInfo {
  appVersion:    string;
  nodeVersion:   string;
  agentVersion:  string;
  uptimeSeconds: number;
  memory: {
    processRssMb:  number;
    processHeapMb: number;
    systemTotalMb: number;
    systemFreeMb:  number;
  };
  cpu: {
    loadAvg1:  number;
    loadAvg5:  number;
    loadAvg15: number;
    cores:     number;
  };
  environment: {
    isDocker: boolean;
    platform: string;
    dbStatus: 'ok' | 'error';
  };
}

export const systemApi = {
  async getInfo(): Promise<SystemInfo> {
    const res = await fetch('/api/system', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch system info');
    return res.json() as Promise<SystemInfo>;
  },
};
