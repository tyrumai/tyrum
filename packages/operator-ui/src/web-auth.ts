export interface WebAuthPersistence {
  hasStoredToken: boolean;
  readToken?(): Promise<string | null> | string | null;
  saveToken(token: string): Promise<void> | void;
  clearToken(): Promise<void> | void;
}
