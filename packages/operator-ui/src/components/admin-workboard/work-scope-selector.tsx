import * as React from "react";
import { Input } from "../ui/input.js";

export type WorkScopeDraft = {
  tenant_id: string;
  agent_id: string;
  workspace_id: string;
};

export type WorkScopeErrors = Partial<Record<keyof WorkScopeDraft, string>>;

export interface WorkScopeSelectorProps {
  value: WorkScopeDraft;
  errors?: WorkScopeErrors;
  onChange: (next: WorkScopeDraft) => void;
}

export function WorkScopeSelector({
  value,
  errors,
  onChange,
}: WorkScopeSelectorProps): React.ReactElement {
  return (
    <div className="grid gap-3 md:grid-cols-3" data-testid="work-scope-selector">
      <Input
        label="Tenant ID"
        required
        value={value.tenant_id}
        error={errors?.tenant_id}
        data-testid="work-scope-tenant-id"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        onChange={(event) => {
          onChange({ ...value, tenant_id: event.target.value });
        }}
      />
      <Input
        label="Agent ID"
        required
        value={value.agent_id}
        error={errors?.agent_id}
        data-testid="work-scope-agent-id"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        onChange={(event) => {
          onChange({ ...value, agent_id: event.target.value });
        }}
      />
      <Input
        label="Workspace ID"
        required
        value={value.workspace_id}
        error={errors?.workspace_id}
        data-testid="work-scope-workspace-id"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        onChange={(event) => {
          onChange({ ...value, workspace_id: event.target.value });
        }}
      />
    </div>
  );
}

