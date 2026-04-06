export const NATIVE_TURN_RUNNER_INPUT_MARKER_KEY = "tyrum_native_turn_runner";
export const NATIVE_TURN_RUNNER_INPUT_MARKER_PATTERN = `%"${NATIVE_TURN_RUNNER_INPUT_MARKER_KEY}":true%`;

export function withNativeTurnRunnerInputMarker<T extends Record<string, unknown>>(
  value: T,
): T & { tyrum_native_turn_runner: true } {
  return {
    ...value,
    [NATIVE_TURN_RUNNER_INPUT_MARKER_KEY]: true,
  };
}
