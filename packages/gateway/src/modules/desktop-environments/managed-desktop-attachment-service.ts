import {
  DEFAULT_PUBLIC_BASE_URL,
  DeploymentConfig,
  SubagentConversationKey,
  isDesktopEnvironmentHostAvailable,
  type DeploymentConfig as DeploymentConfigT,
} from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import {
  ConversationNodeAttachmentDal,
  type ConversationNodeAttachmentRow,
} from "../agent/conversation-node-attachment-dal.js";
import { DeploymentConfigDal } from "../config/deployment-config-dal.js";
import { readDesktopEnvironmentDefaultImageRef } from "./default-image.js";
import { DesktopEnvironmentDal, DesktopEnvironmentHostDal } from "./dal.js";
import { ensureManagedDesktopHandoffTarget } from "./managed-desktop-handoff-target.js";
import { DesktopEnvironmentLifecycleService } from "./lifecycle-service.js";

export const DEFAULT_MANAGED_DESKTOP_IDLE_TIMEOUT_MS = 60 * 60 * 1_000;
const NODE_WAIT_TIMEOUT_MS = 3_000;
const NODE_WAIT_POLL_MS = 250;
const RELEASE_BEHAVIOR = "delete_on_release" as const;

type LoadedAttachmentState = {
  row: ConversationNodeAttachmentRow | undefined;
  environmentExists: boolean;
};

export type ManagedDesktopAttachmentSummary = {
  key: string;
  managed_desktop_attached: boolean;
  desktop_environment_id?: string;
  attached_node_id?: string;
  source_client_device_id?: string;
  last_activity_at_ms?: number;
  exclusive_control?: true;
  handoff_available?: true;
  release_behavior?: typeof RELEASE_BEHAVIOR;
};

export class ManagedDesktopAttachmentService {
  private readonly defaultDeploymentConfig: DeploymentConfigT;

  constructor(
    private readonly opts: {
      db: SqlDb;
      defaultDeploymentConfig?: DeploymentConfigT;
    },
  ) {
    this.defaultDeploymentConfig =
      opts.defaultDeploymentConfig ??
      DeploymentConfig.parse({
        server: { publicBaseUrl: DEFAULT_PUBLIC_BASE_URL },
      });
  }

  private toSummary(input: {
    key: string;
    state: LoadedAttachmentState;
  }): ManagedDesktopAttachmentSummary {
    const { row } = input.state;
    const managedDesktopAttached =
      row?.desktop_environment_id !== null &&
      row?.desktop_environment_id !== undefined &&
      input.state.environmentExists;
    const desktopEnvironmentId = row?.desktop_environment_id ?? undefined;
    return {
      key: input.key,
      managed_desktop_attached: managedDesktopAttached,
      ...(desktopEnvironmentId ? { desktop_environment_id: desktopEnvironmentId } : {}),
      ...(row?.attached_node_id ? { attached_node_id: row.attached_node_id } : {}),
      ...(row?.source_client_device_id
        ? { source_client_device_id: row.source_client_device_id }
        : {}),
      ...(row?.last_activity_at_ms !== null && row?.last_activity_at_ms !== undefined
        ? { last_activity_at_ms: row.last_activity_at_ms }
        : {}),
      ...(managedDesktopAttached
        ? {
            exclusive_control: true,
            handoff_available: true,
            release_behavior: RELEASE_BEHAVIOR,
          }
        : {}),
    };
  }

  private async loadAttachmentState(
    dal: ConversationNodeAttachmentDal,
    environmentDal: DesktopEnvironmentDal,
    input: {
      tenantId: string;
      key: string;
    },
  ): Promise<LoadedAttachmentState> {
    const row = await dal.get(input);
    if (!row?.desktop_environment_id) {
      return { row, environmentExists: false };
    }
    const environment = await environmentDal.get({
      tenantId: input.tenantId,
      environmentId: row.desktop_environment_id,
    });
    return {
      row,
      environmentExists: environment !== undefined,
    };
  }

  private async syncSubagentMirror(input: {
    db: SqlDb;
    tenantId: string;
    key: string;
    desktopEnvironmentId?: string | null;
    attachedNodeId?: string | null;
  }): Promise<void> {
    if (!SubagentConversationKey.safeParse(input.key).success) {
      return;
    }
    await input.db.run(
      `UPDATE subagents
       SET desktop_environment_id = ?,
           attached_node_id = ?,
           updated_at = ?
       WHERE tenant_id = ?
         AND conversation_key = ?`,
      [
        input.desktopEnvironmentId ?? null,
        input.attachedNodeId ?? null,
        new Date().toISOString(),
        input.tenantId,
        input.key,
      ],
    );
  }

  private async clearManagedDesktopFields(input: {
    db: SqlDb;
    dal: ConversationNodeAttachmentDal;
    tenantId: string;
    key: string;
    row: ConversationNodeAttachmentRow | undefined;
    updatedAtMs: number;
  }): Promise<void> {
    if (!input.row) {
      return;
    }

    const clearedUpdatedAtMs = Math.max(input.updatedAtMs, input.row.updated_at_ms);

    if (!input.row.source_client_device_id) {
      await input.dal.delete({
        tenantId: input.tenantId,
        key: input.key,
      });
    } else {
      await input.dal.put({
        tenantId: input.tenantId,
        key: input.key,
        attachedNodeId: null,
        desktopEnvironmentId: null,
        lastActivityAtMs: clearedUpdatedAtMs,
        updatedAtMs: clearedUpdatedAtMs,
      });
    }

    await this.syncSubagentMirror({
      db: input.db,
      tenantId: input.tenantId,
      key: input.key,
      desktopEnvironmentId: null,
      attachedNodeId: null,
    });
  }

  private async resolveHostId(): Promise<string | undefined> {
    const hosts = await new DesktopEnvironmentHostDal(this.opts.db).list();
    return hosts.find((host) => isDesktopEnvironmentHostAvailable(host))?.host_id;
  }

  private async resolveDefaultImageRef(): Promise<string> {
    const { defaultImageRef } = await readDesktopEnvironmentDefaultImageRef({
      deploymentConfigDal: new DeploymentConfigDal(this.opts.db),
      defaultConfig: this.defaultDeploymentConfig,
    });
    return defaultImageRef;
  }

  private async createManagedDesktopEnvironment(input: {
    tenantId: string;
    label: string;
  }): Promise<{ desktopEnvironmentId: string; attachedNodeId?: string } | undefined> {
    const hostId = await this.resolveHostId();
    if (!hostId) {
      return undefined;
    }

    const environmentDal = new DesktopEnvironmentDal(this.opts.db);
    const environment = await environmentDal.create({
      tenantId: input.tenantId,
      hostId,
      label: input.label,
      imageRef: await this.resolveDefaultImageRef(),
      desiredRunning: true,
    });

    const deadline = Date.now() + NODE_WAIT_TIMEOUT_MS;
    let current = environment;
    while (Date.now() < deadline && !current.node_id) {
      await new Promise((resolve) => setTimeout(resolve, NODE_WAIT_POLL_MS));
      const refreshed = await environmentDal.get({
        tenantId: input.tenantId,
        environmentId: current.environment_id,
      });
      if (!refreshed) {
        break;
      }
      current = refreshed;
    }

    return {
      desktopEnvironmentId: current.environment_id,
      attachedNodeId: current.node_id ?? undefined,
    };
  }

  private async deleteEnvironment(tenantId: string, environmentId: string): Promise<void> {
    const lifecycle = new DesktopEnvironmentLifecycleService(
      new DesktopEnvironmentDal(this.opts.db),
    );
    await lifecycle.deleteEnvironment({ tenantId, environmentId });
  }

  private async tryDeleteEnvironment(tenantId: string, environmentId: string): Promise<void> {
    try {
      await this.deleteEnvironment(tenantId, environmentId);
    } catch {
      // Intentional: ignore best-effort cleanup failures after a failed attach/handoff path.
    }
  }

  public async getCurrentAttachmentSummary(input: {
    tenantId: string;
    key: string;
  }): Promise<ManagedDesktopAttachmentSummary> {
    const dal = new ConversationNodeAttachmentDal(this.opts.db);
    const state = await this.loadAttachmentState(
      dal,
      new DesktopEnvironmentDal(this.opts.db),
      input,
    );
    return this.toSummary({
      key: input.key,
      state,
    });
  }

  public async touchConversationActivity(input: {
    tenantId: string;
    key: string;
    sourceClientDeviceId?: string | null;
    attachedNodeId?: string | null;
    updatedAtMs?: number;
  }): Promise<void> {
    const updatedAtMs = input.updatedAtMs ?? Date.now();
    const dal = new ConversationNodeAttachmentDal(this.opts.db);
    const existing = await dal.get(input);
    const shouldCreate =
      input.sourceClientDeviceId !== undefined || input.attachedNodeId !== undefined;
    if (!existing && !shouldCreate) {
      return;
    }
    await dal.put({
      ...input,
      lastActivityAtMs: updatedAtMs,
      updatedAtMs,
      createIfMissing: shouldCreate,
    });
  }

  public async requestManagedDesktop(input: {
    tenantId: string;
    key: string;
    label?: string;
    updatedAtMs?: number;
  }): Promise<ManagedDesktopAttachmentSummary | undefined> {
    const updatedAtMs = input.updatedAtMs ?? Date.now();
    const label = input.label?.trim() || `desktop:${input.key}`;
    const current = await this.getCurrentAttachmentSummary(input);
    if (current.managed_desktop_attached) {
      return current;
    }
    if (current.attached_node_id && !current.desktop_environment_id) {
      throw new Error("current conversation already has a different attached node");
    }

    const created = await this.createManagedDesktopEnvironment({
      tenantId: input.tenantId,
      label,
    });
    if (!created) {
      return undefined;
    }

    let adoptedSummary: ManagedDesktopAttachmentSummary | undefined;
    try {
      await this.opts.db.transaction(async (tx) => {
        const dal = new ConversationNodeAttachmentDal(tx);
        const environmentDal = new DesktopEnvironmentDal(tx);
        const state = await this.loadAttachmentState(dal, environmentDal, input);

        if (state.row?.desktop_environment_id && !state.environmentExists) {
          await this.clearManagedDesktopFields({
            db: tx,
            dal,
            tenantId: input.tenantId,
            key: input.key,
            row: state.row,
            updatedAtMs,
          });
        } else if (state.row?.desktop_environment_id) {
          adoptedSummary = this.toSummary({
            key: input.key,
            state,
          });
          return;
        } else if (state.row?.attached_node_id) {
          throw new Error("current conversation already has a different attached node");
        }

        await dal.put({
          tenantId: input.tenantId,
          key: input.key,
          desktopEnvironmentId: created.desktopEnvironmentId,
          attachedNodeId: created.attachedNodeId ?? null,
          lastActivityAtMs: updatedAtMs,
          updatedAtMs,
          createIfMissing: true,
        });
        await this.syncSubagentMirror({
          db: tx,
          tenantId: input.tenantId,
          key: input.key,
          desktopEnvironmentId: created.desktopEnvironmentId,
          attachedNodeId: created.attachedNodeId ?? null,
        });
      });
    } catch (error) {
      await this.tryDeleteEnvironment(input.tenantId, created.desktopEnvironmentId);
      throw error;
    }

    if (adoptedSummary) {
      await this.tryDeleteEnvironment(input.tenantId, created.desktopEnvironmentId);
      return adoptedSummary;
    }

    return await this.getCurrentAttachmentSummary(input);
  }

  public async releaseManagedDesktop(input: {
    tenantId: string;
    key: string;
    updatedAtMs?: number;
  }): Promise<{ released: boolean; attachment: ManagedDesktopAttachmentSummary }> {
    const updatedAtMs = input.updatedAtMs ?? Date.now();
    const dal = new ConversationNodeAttachmentDal(this.opts.db);
    const state = await this.loadAttachmentState(
      dal,
      new DesktopEnvironmentDal(this.opts.db),
      input,
    );

    if (!state.row?.desktop_environment_id) {
      return {
        released: false,
        attachment: this.toSummary({ key: input.key, state }),
      };
    }

    if (state.environmentExists) {
      await this.deleteEnvironment(input.tenantId, state.row.desktop_environment_id);
    }

    await this.opts.db.transaction(async (tx) => {
      await this.clearManagedDesktopFields({
        db: tx,
        dal: new ConversationNodeAttachmentDal(tx),
        tenantId: input.tenantId,
        key: input.key,
        row: state.row,
        updatedAtMs,
      });
    });

    return {
      released: true,
      attachment: await this.getCurrentAttachmentSummary(input),
    };
  }

  public async handoffManagedDesktop(input: {
    tenantId: string;
    sourceKey: string;
    targetKey: string;
    updatedAtMs?: number;
  }): Promise<{
    source: ManagedDesktopAttachmentSummary;
    target: ManagedDesktopAttachmentSummary;
  }> {
    const updatedAtMs = input.updatedAtMs ?? Date.now();
    if (input.sourceKey === input.targetKey) {
      const current = await this.getCurrentAttachmentSummary({
        tenantId: input.tenantId,
        key: input.sourceKey,
      });
      return { source: current, target: current };
    }

    await ensureManagedDesktopHandoffTarget({
      db: this.opts.db,
      tenantId: input.tenantId,
      key: input.targetKey,
    });

    await this.opts.db.transaction(async (tx) => {
      const dal = new ConversationNodeAttachmentDal(tx);
      const environmentDal = new DesktopEnvironmentDal(tx);
      const source = await this.loadAttachmentState(dal, environmentDal, {
        tenantId: input.tenantId,
        key: input.sourceKey,
      });
      if (!source.row?.desktop_environment_id || !source.environmentExists) {
        throw new Error("current conversation does not own a managed desktop to hand off");
      }

      const target = await this.loadAttachmentState(dal, environmentDal, {
        tenantId: input.tenantId,
        key: input.targetKey,
      });
      if (target.row?.desktop_environment_id) {
        throw new Error("target conversation already owns a managed desktop attachment");
      }
      if (target.row?.attached_node_id) {
        throw new Error("target conversation already has a different attached node");
      }

      await this.clearManagedDesktopFields({
        db: tx,
        dal,
        tenantId: input.tenantId,
        key: input.sourceKey,
        row: source.row,
        updatedAtMs,
      });
      await dal.put({
        tenantId: input.tenantId,
        key: input.targetKey,
        sourceClientDeviceId: target.row?.source_client_device_id,
        attachedNodeId: source.row.attached_node_id,
        desktopEnvironmentId: source.row.desktop_environment_id,
        lastActivityAtMs: updatedAtMs,
        updatedAtMs,
        createIfMissing: true,
      });
      await this.syncSubagentMirror({
        db: tx,
        tenantId: input.tenantId,
        key: input.targetKey,
        desktopEnvironmentId: source.row.desktop_environment_id,
        attachedNodeId: source.row.attached_node_id,
      });
    });

    return {
      source: await this.getCurrentAttachmentSummary({
        tenantId: input.tenantId,
        key: input.sourceKey,
      }),
      target: await this.getCurrentAttachmentSummary({
        tenantId: input.tenantId,
        key: input.targetKey,
      }),
    };
  }
}
