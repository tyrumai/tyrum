import { useState } from "react";
import { toSafeJsonDownloadFileName, useAdminHttpClient } from "./admin-http-shared.js";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";

function ContractsActions({
  busy,
  canGetCatalog,
  canGetSchema,
  schemaFile,
  onSchemaFileChange,
  onGetCatalog,
  onGetSchema,
}: {
  busy: "catalog" | "schema" | null;
  canGetCatalog: boolean;
  canGetSchema: boolean;
  schemaFile: string;
  onSchemaFileChange: (value: string) => void;
  onGetCatalog: () => void;
  onGetSchema: () => void;
}) {
  const isBusy = busy !== null;
  return (
    <>
      <Button
        type="button"
        isLoading={busy === "catalog"}
        disabled={!canGetCatalog || isBusy}
        onClick={() => {
          onGetCatalog();
        }}
      >
        Get catalog
      </Button>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1">
          <Input
            label="Schema file"
            value={schemaFile}
            placeholder="some-contract.json"
            onChange={(event) => {
              onSchemaFileChange(event.currentTarget.value);
            }}
          />
        </div>
        <Button
          type="button"
          isLoading={busy === "schema"}
          disabled={!canGetSchema || isBusy}
          onClick={() => {
            onGetSchema();
          }}
        >
          Get schema
        </Button>
      </div>
    </>
  );
}

function ContractsResults({
  catalogResult,
  catalogError,
  schemaResult,
  schemaError,
  schemaDownloadFileName,
}: {
  catalogResult: unknown | undefined;
  catalogError: unknown | undefined;
  schemaResult: unknown | undefined;
  schemaError: unknown | undefined;
  schemaDownloadFileName: string;
}) {
  return (
    <>
      <ApiResultCard
        heading="Catalog"
        value={catalogResult}
        error={catalogError}
        jsonViewerProps={{ withDownloadButton: true, downloadFileName: "catalog.json" }}
      />
      <ApiResultCard
        heading="Schema"
        value={schemaResult}
        error={schemaError}
        jsonViewerProps={{ withDownloadButton: true, downloadFileName: schemaDownloadFileName }}
      />
    </>
  );
}

export function ContractsCard() {
  const http = useAdminHttpClient();
  const [busy, setBusy] = useState<"catalog" | "schema" | null>(null);
  const [schemaFile, setSchemaFile] = useState("");
  const [schemaFileForSchemaResult, setSchemaFileForSchemaResult] = useState<string | null>(null);
  const [catalogResult, setCatalogResult] = useState<unknown | undefined>(undefined);
  const [catalogError, setCatalogError] = useState<unknown | undefined>(undefined);
  const [schemaResult, setSchemaResult] = useState<unknown | undefined>(undefined);
  const [schemaError, setSchemaError] = useState<unknown | undefined>(undefined);

  const trimmedSchemaFile = schemaFile.trim();
  const canGetCatalog = Boolean(http);
  const canGetSchema = Boolean(http) && trimmedSchemaFile.length > 0;

  const schemaDownloadFileName = toSafeJsonDownloadFileName(
    schemaFileForSchemaResult ?? trimmedSchemaFile,
    "schema.json",
  );

  const getCatalog = (): void => {
    if (busy) return;
    if (!http) return;
    setBusy("catalog");
    setCatalogError(undefined);
    setCatalogResult(undefined);
    void http.contracts
      .getCatalog()
      .then(setCatalogResult)
      .catch(setCatalogError)
      .finally(() => {
        setBusy(null);
      });
  };

  const getSchema = (): void => {
    if (busy) return;
    if (!http) return;
    setSchemaFileForSchemaResult(trimmedSchemaFile);
    setBusy("schema");
    setSchemaError(undefined);
    setSchemaResult(undefined);
    void http.contracts
      .getSchema(trimmedSchemaFile)
      .then(setSchemaResult)
      .catch(setSchemaError)
      .finally(() => {
        setBusy(null);
      });
  };

  return (
    <Card data-testid="admin-http-contracts">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Contracts</div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ContractsActions
          busy={busy}
          canGetCatalog={canGetCatalog}
          canGetSchema={canGetSchema}
          schemaFile={schemaFile}
          onSchemaFileChange={setSchemaFile}
          onGetCatalog={getCatalog}
          onGetSchema={getSchema}
        />
        <ContractsResults
          catalogResult={catalogResult}
          catalogError={catalogError}
          schemaResult={schemaResult}
          schemaError={schemaError}
          schemaDownloadFileName={schemaDownloadFileName}
        />
      </CardContent>
    </Card>
  );
}
