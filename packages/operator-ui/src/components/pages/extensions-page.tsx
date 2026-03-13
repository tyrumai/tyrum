import type { OperatorCore } from "@tyrum/operator-core";
import type { ManagedExtensionDetail } from "@tyrum/schemas";
import { Blocks, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApiAction } from "../../hooks/use-api-action.js";
import { AppPage } from "../layout/app-page.js";
import {
  AdminAccessGate,
  useAdminHttpClient,
  useAdminMutationAccess,
} from "./admin-http-shared.js";
import {
  ExtensionCard,
  ImportGuard,
  McpImportPanel,
  SkillImportPanel,
} from "./extensions-page.sections.js";
import {
  EMPTY_EXTENSIONS_BY_TAB,
  encodeFileToBase64,
  kindToTab,
  sortExtensions,
  tabToKind,
  toErrorMessage,
  type ExtensionKind,
  type ExtensionsTab,
} from "./extensions-page.lib.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { useReconnectScrollArea, useReconnectTabState } from "../../reconnect-ui-state.js";

export function ExtensionsPage({ core }: { core: OperatorCore }) {
  const [tab, setTab] = useReconnectTabState<ExtensionsTab>("extensions.tab", "skills");
  const [items, setItems] = useState(EMPTY_EXTENSIONS_BY_TAB);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailByKey, setDetailByKey] = useState<Record<string, ManagedExtensionDetail>>({});
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const adminHttp = useAdminHttpClient();
  const mutationHttp = adminHttp;
  const extensionsApi = adminHttp?.extensions;
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const mutation = useApiAction<ManagedExtensionDetail>();
  const scrollAreaRef = useReconnectScrollArea(`extensions:${tab}:page`);

  function requireExtensionsMutationApi() {
    if (!mutationHttp?.extensions) {
      throw new Error("Admin access is required to manage extensions.");
    }
    return mutationHttp.extensions;
  }

  useEffect(() => {
    if (!extensionsApi) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const [skills, mcp] = await Promise.all([
          extensionsApi.list("skill"),
          extensionsApi.list("mcp"),
        ]);
        if (cancelled) return;
        setItems({
          skills: skills.items,
          mcp: mcp.items,
        });
      } catch (nextError) {
        if (!cancelled) {
          setError(toErrorMessage(nextError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [extensionsApi, refreshNonce]);

  const selectedDetail = selectedKey ? detailByKey[selectedKey] : undefined;
  const loadingKey = mutation.state.status === "loading" ? selectedKey : null;
  const sortedItems = useMemo(() => sortExtensions(items[tab]), [items, tab]);

  async function refreshListsAndSelect(nextKind: ExtensionKind, key?: string): Promise<void> {
    if (!extensionsApi || !mutationHttp?.extensions) {
      throw new Error("Admin access is required to manage extensions.");
    }
    const [list, detail] = await Promise.all([
      extensionsApi.list(nextKind),
      key ? mutationHttp.extensions.get(nextKind, key) : Promise.resolve(undefined),
    ]);
    setItems((current) => ({
      ...current,
      [kindToTab(nextKind)]: list.items,
    }));
    if (detail && key) {
      setDetailByKey((current) => ({ ...current, [key]: detail.item }));
      setSelectedKey(key);
    }
  }

  function inspect(kind: ExtensionKind, key: string): void {
    setSelectedKey(key);
    void mutation.run(async () => {
      if (!mutationHttp?.extensions) {
        throw new Error("Admin access is required to inspect extensions.");
      }
      const response = await mutationHttp.extensions.get(kind, key);
      setDetailByKey((current) => ({ ...current, [key]: response.item }));
      return response.item;
    });
  }

  function mutateItem(
    kind: ExtensionKind,
    itemKey: string,
    action: () => Promise<{ item: ManagedExtensionDetail }>,
  ): void {
    setSelectedKey(itemKey);
    void mutation.run(async () => {
      const response = await action();
      await refreshListsAndSelect(kind, itemKey);
      return response.item;
    });
  }

  function renderExtensionList(kind: ExtensionKind, emptyMessage: string) {
    return (
      <>
        {sortedItems.length === 0 && !loading ? (
          <Card>
            <CardContent className="pt-6 text-sm text-fg-muted">{emptyMessage}</CardContent>
          </Card>
        ) : null}
        {sortedItems.map((item) => (
          <ExtensionCard
            key={item.key}
            item={item}
            detail={item.key === selectedKey ? selectedDetail : undefined}
            inspectLoading={loadingKey === item.key}
            mutateLoading={loadingKey === item.key}
            onInspect={() => {
              inspect(kind, item.key);
            }}
            onToggle={() => {
              if (!canMutate) return requestEnter();
              mutateItem(
                kind,
                item.key,
                async () =>
                  await mutationHttp!.extensions!.toggle(kind, item.key, {
                    enabled: !item.enabled,
                  }),
              );
            }}
            onRefresh={() => {
              if (!canMutate) return requestEnter();
              mutateItem(
                kind,
                item.key,
                async () => await mutationHttp!.extensions!.refresh(kind, item.key),
              );
            }}
            onRevert={(revision) => {
              if (!canMutate) return requestEnter();
              mutateItem(
                kind,
                item.key,
                async () => await mutationHttp!.extensions!.revert(kind, item.key, { revision }),
              );
            }}
          />
        ))}
      </>
    );
  }

  return (
    <AppPage
      contentClassName="max-w-5xl gap-4"
      data-testid="extensions-page"
      scrollAreaRef={scrollAreaRef}
    >
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 text-base font-semibold text-fg">
            <Blocks className="h-4 w-4" />
            Skills and MCP Servers
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="text-sm text-fg-muted">
            Manage shared Skills and MCP Servers here. Agent assignment stays on the Agents page.
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{`${items.skills.length} skills`}</Badge>
            <Badge variant="outline">{`${items.mcp.length} MCP servers`}</Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              isLoading={loading}
              onClick={() => {
                setRefreshNonce((current) => current + 1);
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
          {error ? (
            <Alert variant="error" title="Failed to load extensions" description={error} />
          ) : null}
        </CardContent>
      </Card>

      {adminHttp ? (
        <ImportGuard canMutate={canMutate} requestEnter={requestEnter}>
          {tabToKind(tab) === "skill" ? (
            <SkillImportPanel
              disabled={!canMutate}
              isLoading={mutation.isLoading}
              onImportUrl={(url) => {
                void mutation.run(async () => {
                  const response = await requireExtensionsMutationApi().importSkill({ url });
                  await refreshListsAndSelect("skill", response.item.key);
                  return response.item;
                });
              }}
              onUpload={(file) => {
                void mutation.run(async () => {
                  const response = await requireExtensionsMutationApi().uploadSkill({
                    filename: file.name,
                    content_type: file.type || undefined,
                    content_base64: await encodeFileToBase64(file),
                  });
                  await refreshListsAndSelect("skill", response.item.key);
                  return response.item;
                });
              }}
            />
          ) : (
            <McpImportPanel
              disabled={!canMutate}
              isLoading={mutation.isLoading}
              onImportRemote={(url) => {
                void mutation.run(async () => {
                  const response = await requireExtensionsMutationApi().importMcp({
                    source: "direct-url",
                    url,
                  });
                  await refreshListsAndSelect("mcp", response.item.key);
                  return response.item;
                });
              }}
              onImportNpm={(npmSpec) => {
                void mutation.run(async () => {
                  const response = await requireExtensionsMutationApi().importMcp({
                    source: "npm",
                    npm_spec: npmSpec,
                  });
                  await refreshListsAndSelect("mcp", response.item.key);
                  return response.item;
                });
              }}
              onUpload={(file) => {
                void mutation.run(async () => {
                  const response = await requireExtensionsMutationApi().uploadMcp({
                    filename: file.name,
                    content_type: file.type || undefined,
                    content_base64: await encodeFileToBase64(file),
                  });
                  await refreshListsAndSelect("mcp", response.item.key);
                  return response.item;
                });
              }}
            />
          )}
        </ImportGuard>
      ) : (
        <AdminAccessGate
          core={core}
          description="Authorizing admin access loads extension inventories and enables import, toggle, refresh, and revert actions."
        >
          {null}
        </AdminAccessGate>
      )}

      {mutation.state.status === "error" ? (
        <Alert
          variant="error"
          title="Extension change failed"
          description={toErrorMessage(mutation.state.error)}
        />
      ) : null}

      {adminHttp ? (
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as ExtensionsTab)}
          className="grid gap-3"
        >
          <TabsList className="flex-wrap">
            <TabsTrigger value="skills">Skills</TabsTrigger>
            <TabsTrigger value="mcp">MCP Servers</TabsTrigger>
          </TabsList>

          <TabsContent value="skills" className="grid gap-3">
            {renderExtensionList("skill", "No managed skills yet.")}
          </TabsContent>

          <TabsContent value="mcp" className="grid gap-3">
            {renderExtensionList("mcp", "No managed MCP servers yet.")}
          </TabsContent>
        </Tabs>
      ) : null}
    </AppPage>
  );
}
