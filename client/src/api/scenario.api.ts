import apiClient from './client';
import type { Scenario, ScenarioRun, ScenarioNode, ScenarioEdge } from '@obliance/shared';

export interface ScenarioGraph { nodes: ScenarioNode[]; edges: ScenarioEdge[] }
export interface ScenarioGraphSavePayload {
  nodes: Array<{
    clientId: string;
    type: string;
    label?: string | null;
    config?: Record<string, unknown>;
    positionX?: number;
    positionY?: number;
  }>;
  edges: Array<{
    sourceClientId: string;
    targetClientId: string;
    sourceHandle?: string | null;
    condition?: any;
    sortOrder?: number;
  }>;
}

interface ApiResponse<T> { data?: T; error?: string; }

export const scenarioApi = {
  async list(params?: Record<string, string>): Promise<Scenario[]> {
    const res = await apiClient.get<ApiResponse<any>>('/scenarios', { params });
    const d = res.data.data;
    // Server returns { items: [...], total } — extract items array
    if (d && Array.isArray(d.items)) return d.items;
    if (Array.isArray(d)) return d;
    return [];
  },
  async getById(id: number): Promise<Scenario> {
    const res = await apiClient.get<ApiResponse<Scenario>>(`/scenarios/${id}`);
    return res.data.data!;
  },
  async create(data: any): Promise<Scenario> {
    const res = await apiClient.post<ApiResponse<Scenario>>('/scenarios', data);
    return res.data.data!;
  },
  async update(id: number, data: any): Promise<Scenario> {
    const res = await apiClient.put<ApiResponse<Scenario>>(`/scenarios/${id}`, data);
    return res.data.data!;
  },
  async delete(id: number): Promise<void> {
    await apiClient.delete(`/scenarios/${id}`);
  },
  async enable(id: number): Promise<void> {
    await apiClient.post(`/scenarios/${id}/enable`);
  },
  async disable(id: number): Promise<void> {
    await apiClient.post(`/scenarios/${id}/disable`);
  },
  async trigger(id: number, deviceIds: number[]): Promise<ScenarioRun[]> {
    const res = await apiClient.post<ApiResponse<ScenarioRun[]>>(`/scenarios/${id}/trigger`, { deviceIds });
    return res.data.data ?? [];
  },
  async resolvedTargets(id: number): Promise<number[]> {
    const res = await apiClient.get<ApiResponse<{ deviceIds: number[] }>>(`/scenarios/${id}/resolved-targets`);
    return res.data.data?.deviceIds ?? [];
  },
  async listRuns(params?: Record<string, any>): Promise<ScenarioRun[]> {
    const res = await apiClient.get<ApiResponse<any>>('/scenarios/runs', { params });
    const d = res.data.data;
    if (d && Array.isArray(d.items)) return d.items;
    if (Array.isArray(d)) return d;
    return [];
  },
  async getRun(runId: string): Promise<ScenarioRun> {
    const res = await apiClient.get<ApiResponse<ScenarioRun>>(`/scenarios/runs/${runId}`);
    return res.data.data!;
  },
  async cancelRun(runId: string): Promise<void> {
    await apiClient.post(`/scenarios/runs/${runId}/cancel`);
  },
  async listTemplates(): Promise<any[]> {
    const res = await apiClient.get<ApiResponse<any[]>>('/scenarios/templates');
    return res.data.data ?? [];
  },
  async instantiateTemplate(index: number, data: { name?: string; variables?: Record<string, string> }): Promise<Scenario> {
    const res = await apiClient.post<ApiResponse<Scenario>>(`/scenarios/templates/${index}/instantiate`, data);
    return res.data.data!;
  },
  // ── v2 graph editor ───────────────────────────────────────────────
  async getGraph(scenarioId: number): Promise<ScenarioGraph> {
    const res = await apiClient.get<ApiResponse<ScenarioGraph>>(`/scenarios/${scenarioId}/graph`);
    return res.data.data ?? { nodes: [], edges: [] };
  },
  async saveGraph(scenarioId: number, payload: ScenarioGraphSavePayload): Promise<void> {
    await apiClient.put(`/scenarios/${scenarioId}/graph`, payload);
  },
  /**
   * Fire a v2 graph run on one or more devices. Returns one run id per
   * device so the editor can aggregate live status across the batch.
   * - `startNodeId` skips the trigger walk and runs that node directly
   *   (right-click "Run from this node").
   * - `singleNode: true` halts with success after the entry node finishes
   *   (right-click "Run only this node").
   */
  async startGraphRun(
    scenarioId: number,
    deviceIds: number[] | number,
    opts?: { startNodeId?: number; triggerNodeId?: number; singleNode?: boolean },
  ): Promise<{ runIds: string[]; runId: string | null; batchMarker: string }> {
    const ids = Array.isArray(deviceIds) ? deviceIds : [deviceIds];
    const res = await apiClient.post<ApiResponse<{ runIds: string[]; runId: string | null; batchMarker: string }>>(
      `/scenarios/${scenarioId}/start-graph-run`,
      { deviceIds: ids, ...(opts ?? {}) },
    );
    return res.data.data!;
  },
  async getActiveRuns(scenarioId: number, sinceMinutes = 60): Promise<{
    runs: Array<{ id: string; deviceId: number; status: string; triggerSource: string | null; startedAt: string; finishedAt: string | null; errorMessage: string | null }>;
    nodeRuns: Array<{ id: string; runId: string; nodeId: number; nodeType: string; status: string; exitCode: number | null; stdout: string | null; stderr: string | null; errorMessage: string | null; startedAt: string; finishedAt: string | null }>;
  }> {
    const res = await apiClient.get(`/scenarios/${scenarioId}/active-runs`, { params: { sinceMinutes } });
    return res.data.data ?? { runs: [], nodeRuns: [] };
  },
  async listForDevice(deviceId: number): Promise<Scenario[]> {
    const res = await apiClient.get<ApiResponse<Scenario[]>>(`/scenarios/for-device/${deviceId}`);
    return res.data.data ?? [];
  },
  async listRunsForDevice(deviceId: number): Promise<ScenarioRun[]> {
    const res = await apiClient.get<ApiResponse<ScenarioRun[]>>(`/scenarios/for-device/${deviceId}/runs`);
    return res.data.data ?? [];
  },
  async listRunsForScenario(scenarioId: number): Promise<ScenarioRun[]> {
    const res = await apiClient.get<ApiResponse<any>>(`/scenarios/${scenarioId}/runs`);
    const d = res.data.data;
    if (d && Array.isArray(d.items)) return d.items;
    if (Array.isArray(d)) return d;
    return [];
  },
};
