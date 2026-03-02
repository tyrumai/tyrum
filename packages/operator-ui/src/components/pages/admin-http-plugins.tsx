import { useState } from "react";
import { toSafeJsonDownloadFileName, useAdminHttpClient } from "./admin-http-shared.js";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";

function PluginsActions({
  busy,
  canList,
  canGet,
  pluginId,
  onPluginIdChange,
  onList,
  onGet,
}: {
  busy: "list" | "get" | null;
  canList: boolean;
  canGet: boolean;
  pluginId: string;
  onPluginIdChange: (value: string) => void;
  onList: () => void;
  onGet: () => void;
}) {
  const isBusy = busy !== null;
  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <Button
          type="button"
          isLoading={busy === "list"}
          disabled={!canList || isBusy}
          onClick={() => {
            onList();
          }}
        >
          List
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1">
          <Input
            label="Plugin ID"
            value={pluginId}
            placeholder="echo"
            onChange={(event) => {
              onPluginIdChange(event.currentTarget.value);
            }}
          />
        </div>
        <Button
          type="button"
          isLoading={busy === "get"}
          disabled={!canGet || isBusy}
          onClick={() => {
            onGet();
          }}
        >
          Get
        </Button>
      </div>
    </>
  );
}

function PluginsResults({
  listResult,
  listError,
  getResult,
  getError,
  getDownloadFileName,
}: {
  listResult: unknown | undefined;
  listError: unknown | undefined;
  getResult: unknown | undefined;
  getError: unknown | undefined;
  getDownloadFileName: string;
}) {
  return (
    <>
      <ApiResultCard
        heading="List result"
        value={listResult}
        error={listError}
        jsonViewerProps={{ withDownloadButton: true, downloadFileName: "plugins.json" }}
      />
      <ApiResultCard
        heading="Get result"
        value={getResult}
        error={getError}
        jsonViewerProps={{ withDownloadButton: true, downloadFileName: getDownloadFileName }}
      />
    </>
  );
}

export function PluginsCard() {
  const http = useAdminHttpClient();
  const [busy, setBusy] = useState<"list" | "get" | null>(null);
  const [pluginId, setPluginId] = useState("");
  const [pluginIdForGetResult, setPluginIdForGetResult] = useState<string | null>(null);
  const [listResult, setListResult] = useState<unknown | undefined>(undefined);
  const [listError, setListError] = useState<unknown | undefined>(undefined);
  const [getResult, setGetResult] = useState<unknown | undefined>(undefined);
  const [getError, setGetError] = useState<unknown | undefined>(undefined);

  const trimmedPluginId = pluginId.trim();
  const canList = Boolean(http);
  const canGet = Boolean(http) && trimmedPluginId.length > 0;

  const getDownloadFileName = toSafeJsonDownloadFileName(
    pluginIdForGetResult ?? trimmedPluginId,
    "plugin.json",
  );

  const list = (): void => {
    if (busy) return;
    if (!http) return;
    setBusy("list");
    setListError(undefined);
    setListResult(undefined);
    void http.plugins
      .list()
      .then(setListResult)
      .catch(setListError)
      .finally(() => {
        setBusy(null);
      });
  };

  const get = (): void => {
    if (busy) return;
    if (!http) return;
    setPluginIdForGetResult(trimmedPluginId);
    setBusy("get");
    setGetError(undefined);
    setGetResult(undefined);
    void http.plugins
      .get(trimmedPluginId)
      .then(setGetResult)
      .catch(setGetError)
      .finally(() => {
        setBusy(null);
      });
  };

  return (
    <Card data-testid="admin-http-plugins">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Plugins</div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <PluginsActions
          busy={busy}
          canList={canList}
          canGet={canGet}
          pluginId={pluginId}
          onPluginIdChange={setPluginId}
          onList={list}
          onGet={get}
        />
        <PluginsResults
          listResult={listResult}
          listError={listError}
          getResult={getResult}
          getError={getError}
          getDownloadFileName={getDownloadFileName}
        />
      </CardContent>
    </Card>
  );
}
