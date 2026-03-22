export const UTILITY_HOST_FLAG = "--tyrum-utility-host";

export function isUtilityHostInvocation(argv: readonly string[]): boolean {
  return argv[2] === UTILITY_HOST_FLAG;
}
