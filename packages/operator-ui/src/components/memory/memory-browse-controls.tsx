import type { Dispatch, SetStateAction } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { MemoryCheckboxField } from "./memory-checkbox-field.js";
import {
  MEMORY_KINDS,
  MEMORY_PROVENANCE_SOURCE_KINDS,
  MEMORY_SENSITIVITIES,
  type MemoryKind,
  type MemoryProvenanceSourceKind,
  type MemorySensitivity,
  updateSetSelection,
} from "./memory-inspector.shared.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";

export interface MemoryBrowseControlsProps {
  browseMode: "list" | "search";
  setBrowseMode: Dispatch<SetStateAction<"list" | "search">>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  filtersOpen: boolean;
  setFiltersOpen: Dispatch<SetStateAction<boolean>>;
  kinds: ReadonlySet<MemoryKind>;
  setKinds: Dispatch<SetStateAction<Set<MemoryKind>>>;
  sensitivities: ReadonlySet<MemorySensitivity>;
  setSensitivities: Dispatch<SetStateAction<Set<MemorySensitivity>>>;
  tags: string;
  setTags: Dispatch<SetStateAction<string>>;
  provenanceSourceKinds: ReadonlySet<MemoryProvenanceSourceKind>;
  setProvenanceSourceKinds: Dispatch<SetStateAction<Set<MemoryProvenanceSourceKind>>>;
  provenanceChannels: string;
  setProvenanceChannels: Dispatch<SetStateAction<string>>;
  provenanceThreadIds: string;
  setProvenanceThreadIds: Dispatch<SetStateAction<string>>;
  provenanceSessionIds: string;
  setProvenanceSessionIds: Dispatch<SetStateAction<string>>;
  browseLoading: boolean;
  browseErrorMessage: string | null;
  onRunBrowse: () => void;
}

export function MemoryBrowseControls({
  browseMode,
  setBrowseMode,
  query,
  setQuery,
  filtersOpen,
  setFiltersOpen,
  kinds,
  setKinds,
  sensitivities,
  setSensitivities,
  tags,
  setTags,
  provenanceSourceKinds,
  setProvenanceSourceKinds,
  provenanceChannels,
  setProvenanceChannels,
  provenanceThreadIds,
  setProvenanceThreadIds,
  provenanceSessionIds,
  setProvenanceSessionIds,
  browseLoading,
  browseErrorMessage,
  onRunBrowse,
}: MemoryBrowseControlsProps) {
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div data-testid="memory-browse-controls" className="grid gap-4">
          <Tabs
            value={browseMode}
            onValueChange={(value) => {
              setBrowseMode(value as "list" | "search");
            }}
          >
            <TabsList>
              <TabsTrigger value="list" data-testid="memory-mode-list">
                List
              </TabsTrigger>
              <TabsTrigger value="search" data-testid="memory-mode-search">
                Search
              </TabsTrigger>
            </TabsList>

            <TabsContent value="list" />
            <TabsContent value="search">
              <Input
                data-testid="memory-query"
                placeholder="Search memories..."
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onRunBrowse();
                }}
              />
            </TabsContent>
          </Tabs>

          <div>
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg"
              onClick={() => {
                setFiltersOpen((prev) => !prev);
              }}
            >
              <ChevronDown
                className={cn("h-3 w-3 transition-transform", filtersOpen ? "" : "-rotate-90")}
              />
              Filters
            </button>

            {filtersOpen ? (
              <div data-testid="memory-filters" className="mt-3 grid gap-3">
                <div>
                  <div className="mb-1.5 text-xs font-medium text-fg-muted">Kind</div>
                  <div className="flex flex-wrap gap-3">
                    {MEMORY_KINDS.map((kind) => (
                      <MemoryCheckboxField
                        key={kind}
                        id={`memory-filter-kind-${kind}`}
                        label={kind}
                        checked={kinds.has(kind)}
                        onCheckedChange={(checked) => {
                          setKinds((prev) => updateSetSelection(prev, kind, checked));
                        }}
                      />
                    ))}
                  </div>
                </div>

                <Input
                  data-testid="memory-filter-tags"
                  label="Tags"
                  value={tags}
                  onChange={(event) => {
                    setTags(event.currentTarget.value);
                  }}
                  placeholder="comma-separated"
                />

                <div>
                  <div className="mb-1.5 text-xs font-medium text-fg-muted">Sensitivity</div>
                  <div className="flex flex-wrap gap-3">
                    {MEMORY_SENSITIVITIES.map((sensitivity) => (
                      <MemoryCheckboxField
                        key={sensitivity}
                        id={`memory-filter-sensitivity-${sensitivity}`}
                        label={sensitivity}
                        checked={sensitivities.has(sensitivity)}
                        onCheckedChange={(checked) => {
                          setSensitivities((prev) =>
                            updateSetSelection(prev, sensitivity, checked),
                          );
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-xs font-medium text-fg-muted">Source</div>
                  <div className="flex flex-wrap gap-3">
                    {MEMORY_PROVENANCE_SOURCE_KINDS.map((sourceKind) => (
                      <MemoryCheckboxField
                        key={sourceKind}
                        id={`memory-filter-provenance-source-${sourceKind}`}
                        label={sourceKind}
                        checked={provenanceSourceKinds.has(sourceKind)}
                        onCheckedChange={(checked) => {
                          setProvenanceSourceKinds((prev) =>
                            updateSetSelection(prev, sourceKind, checked),
                          );
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-3">
                  <Input
                    data-testid="memory-filter-provenance-channels"
                    label="Channels"
                    value={provenanceChannels}
                    onChange={(event) => {
                      setProvenanceChannels(event.currentTarget.value);
                    }}
                    placeholder="comma-separated"
                  />
                  <Input
                    data-testid="memory-filter-provenance-thread-ids"
                    label="Thread IDs"
                    value={provenanceThreadIds}
                    onChange={(event) => {
                      setProvenanceThreadIds(event.currentTarget.value);
                    }}
                    placeholder="comma-separated"
                  />
                  <Input
                    data-testid="memory-filter-provenance-session-ids"
                    label="Session IDs"
                    value={provenanceSessionIds}
                    onChange={(event) => {
                      setProvenanceSessionIds(event.currentTarget.value);
                    }}
                    placeholder="comma-separated"
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              data-testid="memory-run"
              onClick={onRunBrowse}
              isLoading={browseLoading}
            >
              <Search className="h-3.5 w-3.5" />
              {browseMode === "search" ? "Search" : "List"}
            </Button>

            {browseErrorMessage ? (
              <span className="text-xs text-error" role="alert" data-testid="memory-browse-error">
                {browseErrorMessage}
              </span>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
