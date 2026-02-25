import type { Playbook } from "@tyrum/schemas";
import type { ApprovalDal } from "../../modules/approval/dal.js";
import type { CanvasDal } from "../../modules/canvas/dal.js";
import type { MemoryDal } from "../../modules/memory/dal.js";
import type { PlaybookRunner } from "../../modules/playbook/runner.js";
import type { WatcherProcessor } from "../../modules/watcher/processor.js";
import type { SqlDb } from "../../statestore/types.js";

export interface WebUiDeps {
  db?: SqlDb;
  approvalDal: ApprovalDal;
  memoryDal: MemoryDal;
  watcherProcessor: WatcherProcessor;
  canvasDal: CanvasDal;
  playbooks: Playbook[];
  playbookRunner: PlaybookRunner;
  isLocalOnly: boolean;
}
