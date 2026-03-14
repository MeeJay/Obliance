// Client-side types mirroring the server's AgentMetrics and AgentPushSnapshot

export interface AgentDisk {
  mount: string;
  totalGb: number;
  usedGb: number;
  percent: number;
  readBytesPerSec?: number;
  writeBytesPerSec?: number;
}

export interface AgentNetworkInterface {
  name: string;
  inBytesPerSec: number;
  outBytesPerSec: number;
}

export interface AgentGpu {
  model: string;
  utilizationPct: number;
  vramUsedMb: number;
  vramTotalMb: number;
  tempCelsius?: number;
  engines?: Array<{ label: string; pct: number }>;
}

export interface AgentTempSensor {
  label: string;
  celsius: number;
}

export interface AgentFan {
  label: string;
  rpm: number;
  maxRpm?: number; // if known, pct = rpm/maxRpm*100
}

export interface AgentMetrics {
  cpu?: {
    percent: number;
    cores?: number[];           // per-logical-processor percentages
    model?: string;             // CPU model string
    freqMhz?: number;           // base/current clock speed
    coreClocksMhz?: number[];   // per-physical-core effective clock (Windows/LHM)
  };
  memory?: {
    totalMb: number;
    usedMb: number;
    percent: number;
    cachedMb?: number;     // page cache (Linux)
    buffersMb?: number;    // kernel buffers (Linux)
    swapTotalMb?: number;
    swapUsedMb?: number;
  };
  disks?: AgentDisk[];
  network?: {
    inBytesPerSec: number;
    outBytesPerSec: number;
    interfaces?: AgentNetworkInterface[];
  };
  loadAvg?: number;
  gpus?: AgentGpu[];
  temps?: AgentTempSensor[];
  fans?: AgentFan[];
}

export interface AgentPushSnapshot {
  monitorId: number;
  receivedAt: string;       // ISO string from server
  metrics: AgentMetrics;
  violations: string[];
  overallStatus: 'up' | 'alert';
}
