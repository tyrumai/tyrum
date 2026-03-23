export function isDesktopInventoryLoading<Client>(input: {
  currentClient: Client | null;
  loading: boolean;
  loadedForClient: Client | null;
}): boolean {
  return (
    input.loading || (input.currentClient !== null && input.loadedForClient !== input.currentClient)
  );
}
