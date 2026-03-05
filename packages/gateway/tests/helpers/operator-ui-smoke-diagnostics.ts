export interface OperatorUiSmokeDiagnosticsInput {
  url: string;
  consoleErrors?: readonly string[];
  pageErrors?: readonly string[];
  requestFailures?: readonly string[];
  httpErrors?: readonly string[];
}

export function formatOperatorUiSmokeDiagnostics(input: OperatorUiSmokeDiagnosticsInput): string {
  const diagnostics = [
    `url=${input.url}`,
    input.consoleErrors?.length ? `console:\n${input.consoleErrors.join("\n")}` : undefined,
    input.pageErrors?.length ? `pageerror:\n${input.pageErrors.join("\n")}` : undefined,
    input.requestFailures?.length
      ? `requestfailed:\n${input.requestFailures.join("\n")}`
      : undefined,
    input.httpErrors?.length ? `http:\n${input.httpErrors.join("\n")}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  return `Operator UI smoke failed\n\n${diagnostics}`;
}
