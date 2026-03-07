import type { SqlDb } from "../../statestore/types.js";
import { DbSecretProvider } from "./provider.js";
import { createLocalSecretKeyProvider, type SecretKeyProvider } from "./key-provider.js";

export async function createDbSecretProvider(params: {
  db: SqlDb;
  dbPath: string;
  tyrumHome: string;
  tenantId: string;
  keyProvider?: SecretKeyProvider;
}): Promise<DbSecretProvider> {
  const factory = await createDbSecretProviderFactory({
    db: params.db,
    dbPath: params.dbPath,
    tyrumHome: params.tyrumHome,
    keyProvider: params.keyProvider,
  });

  return factory.secretProviderForTenant(params.tenantId);
}

export async function createDbSecretProviderFactory(params: {
  db: SqlDb;
  dbPath: string;
  tyrumHome: string;
  keyProvider?: SecretKeyProvider;
}): Promise<{
  secretProviderForTenant: (tenantId: string) => DbSecretProvider;
  keyId: string;
}> {
  const keyProvider =
    params.keyProvider ??
    createLocalSecretKeyProvider({
      dbPath: params.dbPath,
      tyrumHome: params.tyrumHome,
    });
  const { key: masterKey, keyId } = await keyProvider.getActiveKey();

  return {
    secretProviderForTenant: (tenantId: string) =>
      new DbSecretProvider(params.db, {
        tenantId,
        masterKey,
        keyId,
      }),
    keyId,
  };
}
