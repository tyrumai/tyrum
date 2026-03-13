import {
  type WsApprovalListPayload,
  type WsApprovalListResult as WsApprovalListResultT,
  type WsApprovalResolvePayload,
  type WsApprovalResolveResult as WsApprovalResolveResultT,
  type WsAttemptEvidencePayload,
  type WsRunListPayload,
  type WsRunListResult as WsRunListResultT,
  type WsCapabilityReadyPayload,
  type WsCommandExecutePayload as WsCommandExecutePayloadT,
  type WsCommandExecuteResult as WsCommandExecuteResultT,
  type WsLocationBeaconPayload,
  type WsLocationBeaconResult as WsLocationBeaconResultT,
  type WsPairingApprovePayload,
  type WsPairingDenyPayload,
  type WsPairingResolveResult as WsPairingResolveResultT,
  type WsPairingRevokePayload,
  type WsPresenceBeaconPayload,
  type WsPresenceBeaconResult as WsPresenceBeaconResultT,
  type WsSessionCompactPayload,
  type WsSessionCompactResult as WsSessionCompactResultT,
  type WsSessionCreatePayload,
  type WsSessionCreateResult as WsSessionCreateResultT,
  type WsSessionDeletePayload,
  type WsSessionDeleteResult as WsSessionDeleteResultT,
  type WsSessionGetPayload,
  type WsSessionGetResult as WsSessionGetResultT,
  type WsSessionListPayload,
  type WsSessionListResult as WsSessionListResultT,
  type WsSessionSendPayload,
  type WsSessionSendResult as WsSessionSendResultT,
  type WsSubagentClosePayload,
  type WsSubagentCloseResult as WsSubagentCloseResultT,
  type WsSubagentGetPayload,
  type WsSubagentGetResult as WsSubagentGetResultT,
  type WsSubagentListPayload,
  type WsSubagentListResult as WsSubagentListResultT,
  type WsSubagentSendPayload,
  type WsSubagentSendResult as WsSubagentSendResultT,
  type WsSubagentSpawnPayload,
  type WsSubagentSpawnResult as WsSubagentSpawnResultT,
  type WsWorkArtifactCreatePayload,
  type WsWorkArtifactCreateResult as WsWorkArtifactCreateResultT,
  type WsWorkArtifactGetPayload,
  type WsWorkArtifactGetResult as WsWorkArtifactGetResultT,
  type WsWorkArtifactListPayload,
  type WsWorkArtifactListResult as WsWorkArtifactListResultT,
  type WsWorkCreatePayload,
  type WsWorkCreateResult as WsWorkCreateResultT,
  type WsWorkDecisionCreatePayload,
  type WsWorkDecisionCreateResult as WsWorkDecisionCreateResultT,
  type WsWorkDecisionGetPayload,
  type WsWorkDecisionGetResult as WsWorkDecisionGetResultT,
  type WsWorkDecisionListPayload,
  type WsWorkDecisionListResult as WsWorkDecisionListResultT,
  type WsWorkGetPayload,
  type WsWorkGetResult as WsWorkGetResultT,
  type WsWorkLinkCreatePayload,
  type WsWorkLinkCreateResult as WsWorkLinkCreateResultT,
  type WsWorkLinkListPayload,
  type WsWorkLinkListResult as WsWorkLinkListResultT,
  type WsWorkListPayload,
  type WsWorkListResult as WsWorkListResultT,
  type WsWorkSignalCreatePayload,
  type WsWorkSignalCreateResult as WsWorkSignalCreateResultT,
  type WsWorkSignalGetPayload,
  type WsWorkSignalGetResult as WsWorkSignalGetResultT,
  type WsWorkSignalListPayload,
  type WsWorkSignalListResult as WsWorkSignalListResultT,
  type WsWorkSignalUpdatePayload,
  type WsWorkSignalUpdateResult as WsWorkSignalUpdateResultT,
  type WsWorkStateKvGetPayload,
  type WsWorkStateKvGetResult as WsWorkStateKvGetResultT,
  type WsWorkStateKvListPayload,
  type WsWorkStateKvListResult as WsWorkStateKvListResultT,
  type WsWorkStateKvSetPayload,
  type WsWorkStateKvSetResult as WsWorkStateKvSetResultT,
  type WsWorkTransitionPayload,
  type WsWorkTransitionResult as WsWorkTransitionResultT,
  type WsWorkUpdatePayload,
  type WsWorkUpdateResult as WsWorkUpdateResultT,
  type WsWorkflowCancelPayload,
  type WsWorkflowCancelResult as WsWorkflowCancelResultT,
  type WsWorkflowResumePayload,
  type WsWorkflowResumeResult as WsWorkflowResumeResultT,
  type WsWorkflowRunPayload,
  type WsWorkflowRunResult as WsWorkflowRunResultT,
  WsApprovalListResult,
  WsApprovalResolveResult,
  WsCommandExecuteResult,
  WsLocationBeaconResult,
  WsPairingResolveResult,
  WsPresenceBeaconResult,
  WsRunListResult,
  WsSessionCompactResult,
  WsSessionCreateResult,
  WsSessionDeleteResult,
  WsSessionGetResult,
  WsSessionListResult,
  WsSessionSendResult,
  WsSubagentClosePayload as WsSubagentClosePayloadSchema,
  WsSubagentCloseResult,
  WsSubagentGetPayload as WsSubagentGetPayloadSchema,
  WsSubagentGetResult,
  WsSubagentListPayload as WsSubagentListPayloadSchema,
  WsSubagentListResult,
  WsSubagentSendPayload as WsSubagentSendPayloadSchema,
  WsSubagentSendResult,
  WsSubagentSpawnPayload as WsSubagentSpawnPayloadSchema,
  WsSubagentSpawnResult,
  WsWorkArtifactCreateResult,
  WsWorkArtifactGetResult,
  WsWorkArtifactListResult,
  WsWorkCreateResult,
  WsWorkDecisionCreateResult,
  WsWorkDecisionGetResult,
  WsWorkDecisionListResult,
  WsWorkGetResult,
  WsWorkLinkCreateResult,
  WsWorkLinkListResult,
  WsWorkListResult,
  WsWorkSignalCreateResult,
  WsWorkSignalGetResult,
  WsWorkSignalListResult,
  WsWorkSignalUpdateResult,
  WsWorkStateKvGetResult,
  WsWorkStateKvListResult,
  WsWorkStateKvSetResult,
  WsWorkTransitionResult,
  WsWorkUpdateResult,
  WsWorkflowCancelResult,
  WsWorkflowResumeResult,
  WsWorkflowRunResult,
} from "@tyrum/schemas";
import { TyrumClientTransportCore } from "./ws-client.transport.js";

export type {
  TyrumClientEvents,
  TyrumClientOptions,
  TyrumClientProtocolErrorInfo,
  TyrumClientProtocolErrorKind,
} from "./ws-client.types.js";

export class TyrumClient extends TyrumClientTransportCore {
  approvalList(payload: WsApprovalListPayload = { limit: 100 }): Promise<WsApprovalListResultT> {
    return this.request("approval.list", payload, WsApprovalListResult);
  }
  runList(payload: WsRunListPayload = {}): Promise<WsRunListResultT> {
    return this.request("run.list", payload, WsRunListResult);
  }
  approvalResolve(payload: WsApprovalResolvePayload): Promise<WsApprovalResolveResultT> {
    return this.request("approval.resolve", payload, WsApprovalResolveResult);
  }
  commandExecute(
    command: string,
    context?: Omit<WsCommandExecutePayloadT, "command">,
  ): Promise<WsCommandExecuteResultT> {
    return this.request(
      "command.execute",
      context ? { command, ...context } : { command },
      WsCommandExecuteResult,
    );
  }
  ping(): Promise<void> {
    return this.requestVoid("ping", {});
  }
  sessionSend(payload: WsSessionSendPayload): Promise<WsSessionSendResultT> {
    return this.request("session.send", payload, WsSessionSendResult);
  }
  sessionList(payload: WsSessionListPayload = {}): Promise<WsSessionListResultT> {
    return this.request("session.list", payload, WsSessionListResult);
  }
  sessionGet(payload: WsSessionGetPayload): Promise<WsSessionGetResultT> {
    return this.request("session.get", payload, WsSessionGetResult);
  }
  sessionCreate(payload: WsSessionCreatePayload = {}): Promise<WsSessionCreateResultT> {
    return this.request("session.create", payload, WsSessionCreateResult);
  }
  sessionCompact(payload: WsSessionCompactPayload): Promise<WsSessionCompactResultT> {
    return this.request("session.compact", payload, WsSessionCompactResult);
  }
  sessionDelete(payload: WsSessionDeletePayload): Promise<WsSessionDeleteResultT> {
    return this.request("session.delete", payload, WsSessionDeleteResult);
  }
  workflowRun(payload: WsWorkflowRunPayload): Promise<WsWorkflowRunResultT> {
    return this.request("workflow.run", payload, WsWorkflowRunResult);
  }
  workflowResume(payload: WsWorkflowResumePayload): Promise<WsWorkflowResumeResultT> {
    return this.request("workflow.resume", payload, WsWorkflowResumeResult);
  }
  workflowCancel(payload: WsWorkflowCancelPayload): Promise<WsWorkflowCancelResultT> {
    return this.request("workflow.cancel", payload, WsWorkflowCancelResult);
  }
  pairingApprove(payload: WsPairingApprovePayload): Promise<WsPairingResolveResultT> {
    return this.request("pairing.approve", payload, WsPairingResolveResult);
  }
  pairingDeny(payload: WsPairingDenyPayload): Promise<WsPairingResolveResultT> {
    return this.request("pairing.deny", payload, WsPairingResolveResult);
  }
  pairingRevoke(payload: WsPairingRevokePayload): Promise<WsPairingResolveResultT> {
    return this.request("pairing.revoke", payload, WsPairingResolveResult);
  }
  presenceBeacon(payload: WsPresenceBeaconPayload): Promise<WsPresenceBeaconResultT> {
    return this.request("presence.beacon", payload, WsPresenceBeaconResult);
  }
  locationBeacon(payload: WsLocationBeaconPayload): Promise<WsLocationBeaconResultT> {
    return this.request("location.beacon", payload, WsLocationBeaconResult);
  }
  capabilityReady(payload: WsCapabilityReadyPayload): Promise<void> {
    return this.requestVoid("capability.ready", payload);
  }
  attemptEvidence(payload: WsAttemptEvidencePayload): Promise<void> {
    return this.requestVoid("attempt.evidence", payload);
  }
  workList(payload: WsWorkListPayload): Promise<WsWorkListResultT> {
    return this.request("work.list", payload, WsWorkListResult);
  }
  workGet(payload: WsWorkGetPayload): Promise<WsWorkGetResultT> {
    return this.request("work.get", payload, WsWorkGetResult);
  }
  workCreate(payload: WsWorkCreatePayload): Promise<WsWorkCreateResultT> {
    return this.request("work.create", payload, WsWorkCreateResult);
  }
  workUpdate(payload: WsWorkUpdatePayload): Promise<WsWorkUpdateResultT> {
    return this.request("work.update", payload, WsWorkUpdateResult);
  }
  workTransition(payload: WsWorkTransitionPayload): Promise<WsWorkTransitionResultT> {
    return this.request("work.transition", payload, WsWorkTransitionResult);
  }
  workLinkCreate(payload: WsWorkLinkCreatePayload): Promise<WsWorkLinkCreateResultT> {
    return this.request("work.link.create", payload, WsWorkLinkCreateResult);
  }
  workLinkList(payload: WsWorkLinkListPayload): Promise<WsWorkLinkListResultT> {
    return this.request("work.link.list", payload, WsWorkLinkListResult);
  }
  workArtifactList(payload: WsWorkArtifactListPayload): Promise<WsWorkArtifactListResultT> {
    return this.request("work.artifact.list", payload, WsWorkArtifactListResult);
  }
  workArtifactGet(payload: WsWorkArtifactGetPayload): Promise<WsWorkArtifactGetResultT> {
    return this.request("work.artifact.get", payload, WsWorkArtifactGetResult);
  }
  workArtifactCreate(payload: WsWorkArtifactCreatePayload): Promise<WsWorkArtifactCreateResultT> {
    return this.request("work.artifact.create", payload, WsWorkArtifactCreateResult);
  }
  workDecisionList(payload: WsWorkDecisionListPayload): Promise<WsWorkDecisionListResultT> {
    return this.request("work.decision.list", payload, WsWorkDecisionListResult);
  }
  workDecisionGet(payload: WsWorkDecisionGetPayload): Promise<WsWorkDecisionGetResultT> {
    return this.request("work.decision.get", payload, WsWorkDecisionGetResult);
  }
  workDecisionCreate(payload: WsWorkDecisionCreatePayload): Promise<WsWorkDecisionCreateResultT> {
    return this.request("work.decision.create", payload, WsWorkDecisionCreateResult);
  }
  workSignalList(payload: WsWorkSignalListPayload): Promise<WsWorkSignalListResultT> {
    return this.request("work.signal.list", payload, WsWorkSignalListResult);
  }
  workSignalGet(payload: WsWorkSignalGetPayload): Promise<WsWorkSignalGetResultT> {
    return this.request("work.signal.get", payload, WsWorkSignalGetResult);
  }
  workSignalCreate(payload: WsWorkSignalCreatePayload): Promise<WsWorkSignalCreateResultT> {
    return this.request("work.signal.create", payload, WsWorkSignalCreateResult);
  }
  workSignalUpdate(payload: WsWorkSignalUpdatePayload): Promise<WsWorkSignalUpdateResultT> {
    return this.request("work.signal.update", payload, WsWorkSignalUpdateResult);
  }
  workStateKvGet(payload: WsWorkStateKvGetPayload): Promise<WsWorkStateKvGetResultT> {
    return this.request("work.state_kv.get", payload, WsWorkStateKvGetResult);
  }
  workStateKvList(payload: WsWorkStateKvListPayload): Promise<WsWorkStateKvListResultT> {
    return this.request("work.state_kv.list", payload, WsWorkStateKvListResult);
  }
  workStateKvSet(payload: WsWorkStateKvSetPayload): Promise<WsWorkStateKvSetResultT> {
    return this.request("work.state_kv.set", payload, WsWorkStateKvSetResult);
  }
  async subagentSpawn(payload: WsSubagentSpawnPayload): Promise<WsSubagentSpawnResultT> {
    return this.request(
      "subagent.spawn",
      this.parsePayload("subagent.spawn", payload, WsSubagentSpawnPayloadSchema),
      WsSubagentSpawnResult,
    );
  }
  async subagentList(payload: WsSubagentListPayload): Promise<WsSubagentListResultT> {
    return this.request(
      "subagent.list",
      this.parsePayload("subagent.list", payload, WsSubagentListPayloadSchema),
      WsSubagentListResult,
    );
  }
  async subagentGet(payload: WsSubagentGetPayload): Promise<WsSubagentGetResultT> {
    return this.request(
      "subagent.get",
      this.parsePayload("subagent.get", payload, WsSubagentGetPayloadSchema),
      WsSubagentGetResult,
    );
  }
  async subagentSend(payload: WsSubagentSendPayload): Promise<WsSubagentSendResultT> {
    return this.request(
      "subagent.send",
      this.parsePayload("subagent.send", payload, WsSubagentSendPayloadSchema),
      WsSubagentSendResult,
    );
  }
  async subagentClose(payload: WsSubagentClosePayload): Promise<WsSubagentCloseResultT> {
    return this.request(
      "subagent.close",
      this.parsePayload("subagent.close", payload, WsSubagentClosePayloadSchema),
      WsSubagentCloseResult,
    );
  }
}
