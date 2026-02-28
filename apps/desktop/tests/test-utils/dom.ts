export function getControlByLabelText(labelText: string): HTMLElement {
  const labels = Array.from(document.querySelectorAll("label"));
  const normalizedTarget = labelText.replaceAll(/\s+/g, " ").trim();

  const label = labels.find((node) => {
    const normalized = (node.textContent ?? "").replaceAll(/\s+/g, " ").trim();
    return normalized === normalizedTarget || normalized === `${normalizedTarget}*`;
  });

  if (!label) {
    throw new Error(`Unable to find label with text: ${labelText}`);
  }

  const controlId = label.getAttribute("for");
  if (!controlId) {
    throw new Error(`Label for "${labelText}" did not have a "for" attribute`);
  }

  const control = document.getElementById(controlId);
  if (!control) {
    throw new Error(`Unable to find element with id "${controlId}" for label "${labelText}"`);
  }

  return control;
}

export function getButtonByText(text: string): HTMLButtonElement {
  const normalizedTarget = text.replaceAll(/\s+/g, " ").trim();
  const button = Array.from(document.querySelectorAll("button")).find((node) => {
    const normalized = (node.textContent ?? "").replaceAll(/\s+/g, " ").trim();
    return normalized === normalizedTarget;
  });

  if (!button) {
    throw new Error(`Unable to find button with text: ${text}`);
  }
  return button;
}

export function getSwitchForRowLabelText(labelText: string): HTMLButtonElement {
  const normalizedTarget = labelText.replaceAll(/\s+/g, " ").trim();
  const labelNode = Array.from(document.querySelectorAll("div")).find((node) => {
    const normalized = (node.textContent ?? "").replaceAll(/\s+/g, " ").trim();
    return normalized === normalizedTarget;
  });

  if (!labelNode) {
    throw new Error(`Unable to find row label with text: ${labelText}`);
  }

  const row = labelNode.parentElement;
  if (!row) {
    throw new Error(`Unable to find row parent element for label: ${labelText}`);
  }

  const switchNode = row.querySelector('[role="switch"]');
  if (!switchNode) {
    throw new Error(`Unable to find switch in row for label: ${labelText}`);
  }
  if (!(switchNode instanceof HTMLButtonElement)) {
    throw new Error(`Expected switch to be a button for label: ${labelText}`);
  }

  return switchNode;
}

export function press(element: HTMLElement): void {
  const PointerEventCtor = window.PointerEvent ?? window.MouseEvent;
  element.dispatchEvent(new PointerEventCtor("pointerdown", { bubbles: true, cancelable: true }));
  element.dispatchEvent(new PointerEventCtor("pointerup", { bubbles: true, cancelable: true }));
  element.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
  );
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

export function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (valueSetter) {
    valueSetter.call(input, value);
  } else {
    input.value = value;
  }
  const InputEventCtor = window.InputEvent;
  input.dispatchEvent(
    typeof InputEventCtor === "undefined"
      ? new Event("input", { bubbles: true })
      : new InputEventCtor("input", { bubbles: true }),
  );
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (valueSetter) {
    valueSetter.call(textarea, value);
  } else {
    textarea.value = value;
  }
  const InputEventCtor = window.InputEvent;
  textarea.dispatchEvent(
    typeof InputEventCtor === "undefined"
      ? new Event("input", { bubbles: true })
      : new InputEventCtor("input", { bubbles: true }),
  );
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}
