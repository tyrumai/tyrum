import { Checkbox } from "../ui/checkbox.js";
import { Label } from "../ui/label.js";

export interface MemoryCheckboxFieldProps {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  "data-testid"?: string;
}

export function MemoryCheckboxField({
  id,
  label,
  checked,
  onCheckedChange,
  "data-testid": testId,
}: MemoryCheckboxFieldProps) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        data-testid={testId ?? id}
        checked={checked}
        onCheckedChange={(value) => {
          onCheckedChange(value === true);
        }}
      />
      <Label htmlFor={id} className="cursor-pointer text-xs">
        {label}
      </Label>
    </div>
  );
}
