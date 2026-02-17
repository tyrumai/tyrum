export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface Approval {
  id: string;
  plan_id: string;
  step_index: number;
  prompt: string;
  context: Record<string, unknown>;
  status: ApprovalStatus;
  created_at: string;
  responded_at?: string;
  reason?: string;
}

export interface ApprovalResponse {
  id: string;
  status: ApprovalStatus;
  responded_at: string;
}

export interface ActivityEvent {
  id: string;
  event_type: string;
  channel: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface CanvasMeta {
  id: string;
  title: string;
  content_type: string;
  created_at: string;
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  steps: Array<{ action: string; params: Record<string, unknown> }>;
  created_at: string;
}

export interface PlaybookRunResult {
  run_id: string;
  status: string;
  started_at: string;
}

export interface Watcher {
  id: string;
  trigger_type: "periodic" | "plan_complete";
  trigger_config: Record<string, unknown>;
  plan_id: string;
  active: boolean;
  created_at: string;
}

export interface CreateWatcherRequest {
  trigger_type: "periodic" | "plan_complete";
  trigger_config: Record<string, unknown>;
  plan_id: string;
}

export interface GatewayClientOptions {
  baseUrl: string;
  token?: string;
}

export class GatewayClient {
  constructor(private readonly opts: GatewayClientOptions) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.opts.token
        ? { Authorization: `Bearer ${this.opts.token}` }
        : {}),
    };
    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...init?.headers },
    });
    if (!res.ok) {
      throw new Error(`Gateway request failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async healthz(): Promise<{ status: string; is_exposed?: boolean }> {
    return this.request("/healthz");
  }

  async getFacts(): Promise<Array<{ fact_key: string; fact_value: string }>> {
    return this.request("/memory/facts");
  }

  async getEvents(
    limit?: number,
  ): Promise<Array<Record<string, unknown>>> {
    const query = limit !== undefined ? `?limit=${limit}` : "";
    return this.request(`/memory/events${query}`);
  }

  async agentStatus(): Promise<Record<string, unknown>> {
    return this.request("/agent/status");
  }

  async agentTurn(req: {
    channel: string;
    thread_id: string;
    message: string;
  }): Promise<Record<string, unknown>> {
    return this.request("/agent/turn", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async getApprovals(): Promise<Approval[]> {
    return this.request("/approvals");
  }

  async getApproval(id: string): Promise<Approval> {
    return this.request(`/approvals/${encodeURIComponent(id)}`);
  }

  async respondToApproval(
    id: string,
    decision: "approved" | "denied",
    reason?: string,
  ): Promise<ApprovalResponse> {
    return this.request(`/approvals/${encodeURIComponent(id)}/respond`, {
      method: "POST",
      body: JSON.stringify({ decision, reason }),
    });
  }

  async getCanvasMeta(id: string): Promise<CanvasMeta> {
    return this.request(`/canvas/${encodeURIComponent(id)}/meta`);
  }

  async getPlaybooks(): Promise<Playbook[]> {
    return this.request("/playbooks");
  }

  async runPlaybook(id: string): Promise<PlaybookRunResult> {
    return this.request(`/playbooks/${encodeURIComponent(id)}/run`, {
      method: "POST",
    });
  }

  async getWatchers(): Promise<Watcher[]> {
    return this.request("/watchers");
  }

  async createWatcher(req: CreateWatcherRequest): Promise<Watcher> {
    return this.request("/watchers", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async toggleWatcher(
    id: string,
    active: boolean,
  ): Promise<Watcher> {
    return this.request(`/watchers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    });
  }

  async deleteWatcher(id: string): Promise<void> {
    await this.request(`/watchers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async getCanvasHtml(id: string): Promise<string> {
    const headers: Record<string, string> = this.opts.token
      ? { Authorization: `Bearer ${this.opts.token}` }
      : {};
    const res = await fetch(
      `${this.opts.baseUrl}/canvas/${encodeURIComponent(id)}`,
      { headers },
    );
    if (!res.ok) {
      throw new Error(`Gateway request failed: ${res.status}`);
    }
    return res.text();
  }
}

let defaultClient: GatewayClient | null = null;

export function getGatewayClient(): GatewayClient {
  if (!defaultClient) {
    const baseUrl =
      process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:8080";
    const token = process.env.NEXT_PUBLIC_GATEWAY_TOKEN || undefined;
    defaultClient = new GatewayClient({ baseUrl, token });
  }
  return defaultClient;
}
