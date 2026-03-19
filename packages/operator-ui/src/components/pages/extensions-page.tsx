import type { OperatorCore } from "@tyrum/operator-app";
import type { ManagedExtensionDetail } from "@tyrum/contracts";
import { Blocks, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApiAction } from "../../hooks/use-api-action.js";
import { useReconnectScrollArea, useReconnectTabState } from "../../reconnect-ui-state.js";
import { AppPage } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import {
  useAdminHttpClient,
  useAdminMutationAccess,
  useAdminMutationHttpClient,
} from "./admin-http-shared.js";
import {
  ImportAdminNotice,
  ImportDisclosure,
  McpImportPanel,
  SkillImportPanel,
} from "./extensions-page-import-panels.js";
import {
  EMPTY_EXTENSIONS_BY_TAB,
  encodeFileToBase64,
  kindToTab,
  sortExtensions,
  toErrorMessage,
  type ExtensionKind,
  type ExtensionsTab,
} from "./extensions-page.lib.js";
import { ExtensionCard } from "./extensions-page.sections.js";

type DetailByKind = Record<ExtensionKind, Record<string, ManagedExtensionDetail>>;
type ExpandedKeysByTab = Record<ExtensionsTab, string | null>;
type ImportDisclosures = Record<ExtensionKind, boolean>;
type ActiveItem = { kind: ExtensionKind; key: string } | null;

const EMPTY_DETAIL_BY_KIND: DetailByKind = {
  skill: {},
  mcp: {},
};

const EMPTY_EXPANDED_KEYS: ExpandedKeysByTab = {
  skills: null,
  mcp: null,
};

const DEFAULT_IMPORT_DISCLOSURES: ImportDisclosures = {
  skill: false,
  mcp: false,
};

export function ExtensionsPage({ core }: { core: OperatorCore }) {
  const [tab, setTab] = useReconnectTabState<ExtensionsTab>("extensions.tab", "skills");
  const [items, setItems] = useState(EMPTY_EXTENSIONS_BY_TAB);
  const [detailByKind, setDetailByKind] = useState<DetailByKind>(EMPTY_DETAIL_BY_KIND);
  const [expandedKeys, setExpandedKeys] = useState<ExpandedKeysByTab>(EMPTY_EXPANDED_KEYS);
  const [importDisclosures, setImportDisclosures] = useState<ImportDisclosures>(
    DEFAULT_IMPORT_DISCLOSURES,
  );
  const [activeItem, setActiveItem] = useState<ActiveItem>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const readExtensionsApi = useAdminHttpClient().extensions;
  const mutationHttp = useAdminMutationHttpClient();
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const mutation = useApiAction<ManagedExtensionDetail>();
  const scrollAreaRef = useReconnectScrollArea(`extensions:${tab}:page`);
  const sortedItems = useMemo(
    () => ({
      skills: sortExtensions(items.skills),
      mcp: sortExtensions(items.mcp),
    }),
    [items],
  );

  function requireExtensionsMutationApi() {
    if (!mutationHttp?.extensions) {
      throw new Error("Admin access is required to manage extensions.");
    }
    return mutationHttp.extensions;
  }

  function cacheDetail(kind: ExtensionKind, key: string, item: ManagedExtensionDetail): void {
    setDetailByKind((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        [key]: item,
      },
    }));
  }

  function setExpandedKey(kind: ExtensionKind, key: string | null): void {
    setExpandedKeys((current) => ({
      ...current,
      [kindToTab(kind)]: key,
    }));
  }

  function setImportDisclosure(kind: ExtensionKind, open: boolean): void {
    setImportDisclosures((current) => ({
      ...current,
      [kind]: open,
    }));
  }

  async function refreshListAndDetail(
    kind: ExtensionKind,
    key: string,
    options?: { activateTab?: boolean },
  ): Promise<void> {
    const [list, detail] = await Promise.all([
      readExtensionsApi.list(kind),
      readExtensionsApi.get(kind, key),
    ]);
    setItems((current) => ({
      ...current,
      [kindToTab(kind)]: list.items,
    }));
    cacheDetail(kind, key, detail.item);
    setExpandedKey(kind, key);
    if (options?.activateTab) {
      setTab(kindToTab(kind));
    }
  }

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const [skills, mcp] = await Promise.all([
          readExtensionsApi.list("skill"),
          readExtensionsApi.list("mcp"),
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
  }, [readExtensionsApi, refreshNonce]);

  function toggleInspect(kind: ExtensionKind, key: string): void {
    const tabKey = kindToTab(kind);
    if (expandedKeys[tabKey] === key) {
      setExpandedKey(kind, null);
      return;
    }

    setExpandedKey(kind, key);
    if (detailByKind[kind][key]) {
      return;
    }

    setActiveItem({ kind, key });
    void mutation.run(async () => {
      const response = await readExtensionsApi.get(kind, key);
      cacheDetail(kind, key, response.item);
      return response.item;
    });
  }

  function mutateItem(
    kind: ExtensionKind,
    itemKey: string,
    action: () => Promise<{ item: ManagedExtensionDetail }>,
  ): void {
    setActiveItem({ kind, key: itemKey });
    setExpandedKey(kind, itemKey);
    void mutation.run(async () => {
      const response = await action();
      await refreshListAndDetail(kind, itemKey);
      return response.item;
    });
  }

  function renderExtensionList(kind: ExtensionKind, emptyMessage: string) {
    const listTab = kindToTab(kind);
    const expandedKey = expandedKeys[listTab];
    const entries = sortedItems[listTab];

    return (
      <>
        {entries.length === 0 && !loading ? (
          <Card>
            <CardContent className="pt-6 text-sm text-fg-muted">{emptyMessage}</CardContent>
          </Card>
        ) : null}
        {entries.map((item) => {
          const itemIsLoading =
            mutation.state.status === "loading" &&
            activeItem?.kind === kind &&
            activeItem.key === item.key;

          return (
            <ExtensionCard
              key={item.key}
              item={item}
              detail={item.key === expandedKey ? detailByKind[kind][item.key] : undefined}
              isExpanded={item.key === expandedKey}
              inspectLoading={itemIsLoading}
              mutateLoading={itemIsLoading}
              canMutate={canMutate}
              requestEnter={requestEnter}
              onInspect={() => {
                toggleInspect(kind, item.key);
              }}
              onToggle={() => {
                if (!canMutate) return requestEnter();
                mutateItem(
                  kind,
                  item.key,
                  async () =>
                    await requireExtensionsMutationApi().toggle(kind, item.key, {
                      enabled: !item.enabled,
                    }),
                );
              }}
              onRefresh={() => {
                if (!canMutate) return requestEnter();
                mutateItem(
                  kind,
                  item.key,
                  async () => await requireExtensionsMutationApi().refresh(kind, item.key),
                );
              }}
              onRevert={(revision) => {
                if (!canMutate) return requestEnter();
                mutateItem(
                  kind,
                  item.key,
                  async () =>
                    await requireExtensionsMutationApi().revert(kind, item.key, { revision }),
                );
              }}
              onUpdateDefaults={(input) => {
                mutateItem(
                  kind,
                  item.key,
                  async () =>
                    await requireExtensionsMutationApi().updateDefaults(kind, item.key, input),
                );
              }}
            />
          );
        })}
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
            Manage discoverable Skills and MCP Servers here. Shared defaults apply to agents until
            an agent explicitly overrides them.
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
            <Alert
              variant="error"
              title="Failed to load extensions"
              description={error}
              onDismiss={() => setError(null)}
            />
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-3">
        <ImportDisclosure
          title="Import Skill"
          open={importDisclosures.skill}
          onToggle={() => {
            setImportDisclosure("skill", !importDisclosures.skill);
          }}
        >
          <ImportAdminNotice canMutate={canMutate} requestEnter={requestEnter} />
          <SkillImportPanel
            disabled={!canMutate}
            isLoading={mutation.isLoading}
            onImportUrl={(url) => {
              setActiveItem(null);
              void mutation.run(async () => {
                const response = await requireExtensionsMutationApi().importSkill({ url });
                await refreshListAndDetail("skill", response.item.key, { activateTab: true });
                setImportDisclosure("skill", false);
                return response.item;
              });
            }}
            onUpload={(file) => {
              setActiveItem(null);
              void mutation.run(async () => {
                const response = await requireExtensionsMutationApi().uploadSkill({
                  filename: file.name,
                  content_type: file.type || undefined,
                  content_base64: await encodeFileToBase64(file),
                });
                await refreshListAndDetail("skill", response.item.key, { activateTab: true });
                setImportDisclosure("skill", false);
                return response.item;
              });
            }}
          />
        </ImportDisclosure>

        <ImportDisclosure
          title="Import MCP Server"
          open={importDisclosures.mcp}
          onToggle={() => {
            setImportDisclosure("mcp", !importDisclosures.mcp);
          }}
        >
          <ImportAdminNotice canMutate={canMutate} requestEnter={requestEnter} />
          <McpImportPanel
            disabled={!canMutate}
            isLoading={mutation.isLoading}
            onImportRemote={(url) => {
              setActiveItem(null);
              void mutation.run(async () => {
                const response = await requireExtensionsMutationApi().importMcp({
                  source: "direct-url",
                  url,
                });
                await refreshListAndDetail("mcp", response.item.key, { activateTab: true });
                setImportDisclosure("mcp", false);
                return response.item;
              });
            }}
            onImportNpm={(npmSpec) => {
              setActiveItem(null);
              void mutation.run(async () => {
                const response = await requireExtensionsMutationApi().importMcp({
                  source: "npm",
                  npm_spec: npmSpec,
                });
                await refreshListAndDetail("mcp", response.item.key, { activateTab: true });
                setImportDisclosure("mcp", false);
                return response.item;
              });
            }}
            onUpload={(file) => {
              setActiveItem(null);
              void mutation.run(async () => {
                const response = await requireExtensionsMutationApi().uploadMcp({
                  filename: file.name,
                  content_type: file.type || undefined,
                  content_base64: await encodeFileToBase64(file),
                });
                await refreshListAndDetail("mcp", response.item.key, { activateTab: true });
                setImportDisclosure("mcp", false);
                return response.item;
              });
            }}
          />
        </ImportDisclosure>
      </div>

      {mutation.state.status === "error" ? (
        <Alert
          variant="error"
          title="Extension action failed"
          description={toErrorMessage(mutation.state.error)}
          onDismiss={() => mutation.reset()}
        />
      ) : null}

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
          {renderExtensionList("skill", "No discoverable skills yet.")}
        </TabsContent>

        <TabsContent value="mcp" className="grid gap-3">
          {renderExtensionList("mcp", "No discoverable MCP servers yet.")}
        </TabsContent>
      </Tabs>
    </AppPage>
  );
}
