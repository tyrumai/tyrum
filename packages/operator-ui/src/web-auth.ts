export interface WebAuthPersistence {
  hasStoredToken: boolean;
  saveToken(token: string): Promise<void> | void;
  clearToken(): Promise<void> | void;
}
