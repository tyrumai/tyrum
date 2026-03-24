export function getControlByLabel<T extends HTMLElement>(
  root: HTMLElement,
  selector: "input" | "select" | "textarea",
  labelText: string,
): T | null {
  const label = Array.from(root.querySelectorAll<HTMLLabelElement>("label")).find((candidate) =>
    candidate.textContent?.includes(labelText),
  );
  if (!label?.htmlFor) return null;
  return root.querySelector<T>(`${selector}[id="${label.htmlFor}"]`);
}

export function setSelectValue(select: HTMLSelectElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  descriptor?.set?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
