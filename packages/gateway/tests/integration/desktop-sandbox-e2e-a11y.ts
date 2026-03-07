import type { DesktopQueryMatch } from "@tyrum/schemas";

import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { delay, type ExecutionScopeIds } from "./desktop-sandbox-e2e-support.js";

type DesktopDispatchContext = {
  tenantId: string;
  runId: string;
  stepId: string;
  attemptId: string;
};

type DesktopDispatchService = {
  dispatchAndWait(
    request: { type: "Desktop"; args: Record<string, unknown> },
    context: DesktopDispatchContext,
    options: { timeoutMs: number },
  ): Promise<{
    result: {
      ok: boolean;
      result?: unknown;
      error?: string;
    };
  }>;
};

type DockerExec = (
  containerName: string,
  command: string,
  timeoutMs?: number,
) => {
  status: number | null;
  stdout: string;
  stderr: string;
};

function extractMatches(result: { ok: boolean; result?: unknown }): DesktopQueryMatch[] {
  if (!result.ok) return [];
  const payload = result.result as { matches?: unknown } | undefined;
  return Array.isArray(payload?.matches) ? (payload.matches as DesktopQueryMatch[]) : [];
}

function containsBounds(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
): boolean {
  if (inner.width <= 0 || inner.height <= 0) return false;
  const outerRight = outer.x + outer.width;
  const outerBottom = outer.y + outer.height;
  const innerRight = inner.x + inner.width;
  const innerBottom = inner.y + inner.height;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    innerRight <= outerRight &&
    innerBottom <= outerBottom
  );
}

async function clickDesktopRef(
  nodeDispatchService: DesktopDispatchService,
  context: DesktopDispatchContext,
  elementRef: string,
): Promise<void> {
  const click = await nodeDispatchService.dispatchAndWait(
    {
      type: "Desktop",
      args: {
        op: "act",
        target: { kind: "ref", ref: elementRef },
        action: { kind: "click" },
      },
    },
    context,
    { timeoutMs: 60_000 },
  );
  if (!click.result.ok) {
    throw new Error(`Desktop a11y act(click) failed: ${click.result.error ?? "<missing>"}`);
  }
}

export async function runZenityA11ySmoke(params: {
  containerName: string;
  dockerExec: DockerExec;
  nodeDispatchService: DesktopDispatchService;
  scope: ExecutionScopeIds;
  truncate: (text: string, maxChars: number) => string;
}): Promise<void> {
  const hasZenity = params.dockerExec(params.containerName, "command -v zenity >/dev/null 2>&1").status === 0;
  if (!hasZenity) return;

  const context: DesktopDispatchContext = {
    tenantId: DEFAULT_TENANT_ID,
    runId: params.scope.runId,
    stepId: params.scope.stepId,
    attemptId: params.scope.attemptId,
  };
  const okLabel = "Tyrum A11y OK";
  const startDialog = params.dockerExec(
    params.containerName,
    [
      "DISPLAY=:0",
      "zenity --question",
      '--title "Tyrum A11y Smoke"',
      '--text "AT-SPI click smoke"',
      `--ok-label "${okLabel}"`,
      '--cancel-label "Tyrum A11y Cancel"',
      ">/tmp/tyrum-zenity.log 2>&1 &",
    ].join(" "),
  );
  if (startDialog.status !== 0) {
    throw new Error(
      [
        "Failed to start zenity dialog inside desktop-sandbox container.",
        startDialog.stdout,
        startDialog.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const okButtonQueryDeadlineMs = Date.now() + 10_000;
  let okButton: (DesktopQueryMatch & { kind: "a11y" }) | undefined;
  for (;;) {
    const query = await params.nodeDispatchService.dispatchAndWait(
      {
        type: "Desktop",
        args: {
          op: "query",
          selector: { kind: "a11y", role: "push button", name: okLabel },
          limit: 1,
        },
      },
      context,
      { timeoutMs: 60_000 },
    );

    const match = extractMatches(query.result)[0];
    if (match?.kind === "a11y") {
      okButton = match;
      break;
    }
    if (Date.now() > okButtonQueryDeadlineMs) break;
    await delay(500);
  }

  if (okButton) {
    if (!okButton.node.name.toLowerCase().includes(okLabel.toLowerCase())) {
      throw new Error("Desktop a11y located an unexpected zenity OK button.");
    }
    await clickDesktopRef(params.nodeDispatchService, context, okButton.element_ref);
  } else {
    const dialogDeadlineMs = Date.now() + 30_000;
    let dialog: (DesktopQueryMatch & { kind: "a11y" }) | undefined;
    for (;;) {
      const query = await params.nodeDispatchService.dispatchAndWait(
        {
          type: "Desktop",
          args: {
            op: "query",
            selector: { kind: "a11y", role: "dialog", states: ["active"] },
            limit: 1,
          },
        },
        context,
        { timeoutMs: 60_000 },
      );

      const match = extractMatches(query.result)[0];
      if (match?.kind === "a11y") {
        dialog = match;
        break;
      }
      if (Date.now() > dialogDeadlineMs) {
        throw new Error("Desktop a11y could not locate active dialog after starting zenity.");
      }

      await delay(500);
    }

    const buttonDeadlineMs = Date.now() + 30_000;
    let buttonCandidates: Array<DesktopQueryMatch & { kind: "a11y" }> = [];
    for (;;) {
      const query = await params.nodeDispatchService.dispatchAndWait(
        {
          type: "Desktop",
          args: {
            op: "query",
            selector: { kind: "a11y", role: "push button" },
            limit: 64,
          },
        },
        context,
        { timeoutMs: 60_000 },
      );

      const candidates = extractMatches(query.result).filter(
        (match): match is DesktopQueryMatch & { kind: "a11y" } => match.kind === "a11y",
      );
      buttonCandidates = candidates.filter((match) =>
        containsBounds(dialog.node.bounds, match.node.bounds),
      );
      if (buttonCandidates.length > 0) break;
      if (Date.now() > buttonDeadlineMs) {
        throw new Error("Desktop a11y could not locate a dialog button to click.");
      }

      await delay(500);
    }

    const defaultButton = buttonCandidates.find((candidate) =>
      candidate.node.states.some((state) => state.trim().toLowerCase() === "is_default"),
    );
    const chosen =
      defaultButton ??
      buttonCandidates.toSorted((a, b) => b.node.bounds.x - a.node.bounds.x)[0];
    if (!chosen) {
      throw new Error("Desktop a11y could not locate a dialog button to click.");
    }
    await clickDesktopRef(params.nodeDispatchService, context, chosen.element_ref);
  }

  const closeDeadlineMs = Date.now() + 30_000;
  for (;;) {
    const ps = params.dockerExec(
      params.containerName,
      "command -v ps >/dev/null 2>&1 && ps -eo pid,args | grep -i zenity | grep -v grep || true",
    );
    const stillRunning = (ps.stdout + ps.stderr).trim().length > 0;
    if (!stillRunning) return;
    if (Date.now() > closeDeadlineMs) {
      const zenityLog = params.dockerExec(
        params.containerName,
        "tail -n 200 /tmp/tyrum-zenity.log 2>/dev/null || true",
      );
      throw new Error(
        [
          "Desktop a11y click did not dismiss zenity dialog in time.",
          "--- /tmp/tyrum-zenity.log ---",
          params.truncate(zenityLog.stdout + zenityLog.stderr, 4_000),
        ].join("\n"),
      );
    }

    await delay(500);
  }
}
