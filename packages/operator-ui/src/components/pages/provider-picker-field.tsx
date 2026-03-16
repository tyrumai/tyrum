import * as React from "react";
import { cn } from "../../lib/cn.js";
import { Label } from "../ui/label.js";
import { ScrollArea } from "../ui/scroll-area.js";
import type {
  ConfiguredProviderGroup,
  ProviderRegistryEntry,
} from "./admin-http-providers.shared.js";

const PROVIDER_PICKER_VISIBLE_COUNT = 5;
const PROVIDER_PICKER_ROW_REM = 4.25;

export function ProviderPickerField({
  configuredProviders,
  filteredProviders,
  onProviderFilterChange,
  onSelectProvider,
  providerFilter,
  selectedProviderKey,
}: {
  configuredProviders: readonly ConfiguredProviderGroup[];
  filteredProviders: readonly ProviderRegistryEntry[];
  onProviderFilterChange: (value: string) => void;
  onSelectProvider: (providerKey: string) => void;
  providerFilter: string;
  selectedProviderKey: string;
}): React.ReactElement {
  const providerFilterId = React.useId();
  const configuredCounts = React.useMemo(
    () =>
      new Map(
        configuredProviders.map((provider) => [provider.provider_key, provider.accounts.length]),
      ),
    [configuredProviders],
  );
  const providerPickerHeightRem =
    Math.min(Math.max(filteredProviders.length, 1), PROVIDER_PICKER_VISIBLE_COUNT) *
    PROVIDER_PICKER_ROW_REM;
  const selectedProviderConfiguredCount = selectedProviderKey
    ? (configuredCounts.get(selectedProviderKey) ?? 0)
    : 0;

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={providerFilterId} required>
        Provider
      </Label>
      <div className="overflow-hidden rounded-lg border border-border bg-bg-card/40">
        <div className="border-b border-border/70 p-2">
          <input
            id={providerFilterId}
            type="text"
            value={providerFilter}
            data-testid="providers-filter-input"
            aria-label="Filter providers"
            placeholder="Filter providers by name or key"
            onChange={(event) => {
              onProviderFilterChange(event.currentTarget.value);
            }}
            className={cn(
              "box-border flex h-8 w-full rounded-md border border-border bg-bg px-2.5 py-1 text-sm text-fg transition-[border-color,box-shadow] duration-150",
              "placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
            )}
          />
        </div>
        <ScrollArea
          className="w-full"
          data-testid="providers-provider-picker"
          style={{ height: `${providerPickerHeightRem}rem` }}
        >
          <div className="grid gap-1 p-2" role="radiogroup" aria-label="Provider">
            {filteredProviders.length > 0 ? (
              filteredProviders.map((provider) => {
                const active = provider.provider_key === selectedProviderKey;
                const configuredCount = configuredCounts.get(provider.provider_key) ?? 0;
                const accountLabel =
                  configuredCount === 1
                    ? "1 account configured"
                    : `${configuredCount} accounts configured`;

                return (
                  <button
                    key={provider.provider_key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-testid={`providers-provider-option-${provider.provider_key}`}
                    className={cn(
                      "flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
                      active
                        ? "border-primary bg-bg text-fg"
                        : "border-border bg-bg hover:bg-bg-subtle",
                    )}
                    onClick={() => {
                      onSelectProvider(provider.provider_key);
                    }}
                  >
                    <div className="grid gap-0.5">
                      <span className="text-sm font-medium text-fg">{provider.name}</span>
                      <span className="text-xs text-fg-muted">{provider.provider_key}</span>
                    </div>
                    <div className="grid justify-items-end gap-1 text-xs text-fg-muted">
                      {configuredCount > 0 ? (
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5",
                            active
                              ? "border-primary/50 bg-primary/10 text-fg"
                              : "border-border bg-bg-card/60",
                          )}
                        >
                          {accountLabel}
                        </span>
                      ) : (
                        <span>Not configured</span>
                      )}
                      {provider.methods.length > 1 ? (
                        <span>{provider.methods.length} auth methods</span>
                      ) : null}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-fg-muted">
                No providers match this filter.
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
      <p className="text-sm text-fg-muted">
        Type to narrow the list. Up to five providers stay visible before scrolling.
      </p>
      {selectedProviderConfiguredCount > 0 ? (
        <p className="text-sm text-fg-muted">
          This provider is already configured. Saving will add another account.
        </p>
      ) : null}
    </div>
  );
}
