import { join } from "node:path";
import { EnvSecretProvider, FileSecretProvider, KeychainSecretProvider } from "./provider.js";
import type { SecretProvider } from "./provider.js";

type SecretProviderKind = "env" | "file" | "keychain";

function resolveSecretProviderKind(): SecretProviderKind {
  const desiredProvider = process.env["TYRUM_SECRET_PROVIDER"]?.trim().toLowerCase();
  const isKubernetes = Boolean(process.env["KUBERNETES_SERVICE_HOST"]);
  if (desiredProvider === "env" || desiredProvider === "file" || desiredProvider === "keychain") {
    return desiredProvider;
  }
  return isKubernetes ? "env" : "file";
}

export async function createSecretProviderFromEnv(
  tyrumHome: string,
  token: string | undefined,
): Promise<SecretProvider> {
  const providerKind = resolveSecretProviderKind();

  if (providerKind === "env") {
    return new EnvSecretProvider();
  }
  if (providerKind === "keychain") {
    const secretsPath = join(tyrumHome, "secrets.keychain.json");
    return await KeychainSecretProvider.create(secretsPath);
  }

  if (!token || token.trim().length === 0) {
    throw new Error("FileSecretProvider requires a non-empty admin token");
  }
  const secretsPath = join(tyrumHome, "secrets.json");
  return await FileSecretProvider.create(secretsPath, token);
}
