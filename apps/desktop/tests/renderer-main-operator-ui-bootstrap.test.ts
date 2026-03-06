// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

type DesktopOperatorCoreState = {
  core: unknown | null;
  elevatedModeController: { enter: () => Promise<void>; exit: () => Promise<void> } | null;
  busy: boolean;
  errorMessage: string | null;
  needsConfiguration: boolean;
  retry: () => void;
};

type ReactElementLike = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

function isReactElementLike(value: unknown): value is ReactElementLike {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    "props" in value &&
    typeof (value as { props?: unknown }).props === "object"
  );
}

function unwrapSingleChild(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new Error(`Expected a single child, got ${value.length}.`);
    }
    return value[0];
  }
  return value;
}

function findFirstElement(
  node: unknown,
  predicate: (element: ReactElementLike) => boolean,
): ReactElementLike | null {
  if (node === null || node === undefined || typeof node === "boolean") return null;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findFirstElement(entry, predicate);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === "string" || typeof node === "number") return null;
  if (!isReactElementLike(node)) return null;

  if (predicate(node)) return node;
  return findFirstElement(node.props.children, predicate);
}

function collectText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isReactElementLike(node)) return "";
  return collectText(node.props.children);
}

const {
  AlertMock,
  ButtonMock,
  CardContentMock,
  CardMock,
  ErrorBoundaryMock,
  InputMock,
  OperatorUiAppMock,
  OperatorUiHostProviderMock,
  ThemeProviderMock,
  createRootMock,
  desktopApi,
  getDesktopApiMock,
  renderMock,
  setDesktopOperatorCoreState,
  useDesktopOperatorCoreMock,
} = vi.hoisted(() => {
  const renderMockInner = vi.fn();
  const createRootMockInner = vi.fn(() => ({ render: renderMockInner }));

  const desktopApiInner = { kind: "desktop-api" as const };
  const getDesktopApiMockInner = vi.fn(() => desktopApiInner);

  let operatorCoreState: DesktopOperatorCoreState = {
    core: null,
    elevatedModeController: null,
    busy: false,
    errorMessage: null,
    needsConfiguration: false,
    retry: vi.fn(),
  };
  const setDesktopOperatorCoreStateInner = (next: DesktopOperatorCoreState): void => {
    operatorCoreState = next;
  };
  const useDesktopOperatorCoreMockInner = vi.fn(() => operatorCoreState);

  const ThemeProviderMockInner = vi.fn(({ children }: { children: unknown }) => children ?? null);
  const ErrorBoundaryMockInner = vi.fn(({ children }: { children: unknown }) => children ?? null);

  const OperatorUiHostProviderMockInner = vi.fn(
    ({ children }: { children: unknown }) => children ?? null,
  );
  const OperatorUiAppMockInner = vi.fn(() => null);

  const AlertMockInner = vi.fn(() => null);
  const ButtonMockInner = vi.fn(() => null);
  const CardMockInner = vi.fn(() => null);
  const CardContentMockInner = vi.fn(() => null);
  const InputMockInner = vi.fn(() => null);

  return {
    AlertMock: AlertMockInner,
    ButtonMock: ButtonMockInner,
    CardContentMock: CardContentMockInner,
    CardMock: CardMockInner,
    ErrorBoundaryMock: ErrorBoundaryMockInner,
    InputMock: InputMockInner,
    OperatorUiAppMock: OperatorUiAppMockInner,
    OperatorUiHostProviderMock: OperatorUiHostProviderMockInner,
    ThemeProviderMock: ThemeProviderMockInner,
    createRootMock: createRootMockInner,
    desktopApi: desktopApiInner,
    getDesktopApiMock: getDesktopApiMockInner,
    renderMock: renderMockInner,
    setDesktopOperatorCoreState: setDesktopOperatorCoreStateInner,
    useDesktopOperatorCoreMock: useDesktopOperatorCoreMockInner,
  };
});

vi.mock("react-dom/client", () => ({
  createRoot: createRootMock,
}));

vi.mock("@tyrum/operator-ui", () => ({
  Alert: AlertMock,
  Button: ButtonMock,
  Card: CardMock,
  CardContent: CardContentMock,
  ErrorBoundary: ErrorBoundaryMock,
  Input: InputMock,
  OperatorUiApp: OperatorUiAppMock,
  OperatorUiHostProvider: OperatorUiHostProviderMock,
  ThemeProvider: ThemeProviderMock,
  getDesktopApi: getDesktopApiMock,
}));

vi.mock("../src/renderer/lib/desktop-operator-core.js", () => ({
  useDesktopOperatorCore: useDesktopOperatorCoreMock,
}));

describe("desktop renderer main bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="root"></div>';
  });

  function loadDesktopBootstrap(): () => unknown {
    expect(renderMock).toHaveBeenCalledTimes(1);

    const rootElement = renderMock.mock.calls[0]?.[0] as unknown;
    expect(isReactElementLike(rootElement)).toBe(true);
    expect((rootElement as ReactElementLike).type).toBe(ThemeProviderMock);

    const errorBoundaryElement = unwrapSingleChild(
      (rootElement as ReactElementLike).props.children,
    ) as unknown;
    expect(isReactElementLike(errorBoundaryElement)).toBe(true);
    expect((errorBoundaryElement as ReactElementLike).type).toBe(ErrorBoundaryMock);

    const desktopBootstrapElement = unwrapSingleChild(
      (errorBoundaryElement as ReactElementLike).props.children,
    ) as unknown;
    expect(isReactElementLike(desktopBootstrapElement)).toBe(true);

    return (desktopBootstrapElement as ReactElementLike).type as () => unknown;
  }

  it("boots OperatorUiApp in desktop mode when operator core is available", async () => {
    const retry = vi.fn();
    const core = { name: "core" };
    setDesktopOperatorCoreState({
      core,
      elevatedModeController: {
        enter: vi.fn(async () => {}),
        exit: vi.fn(async () => {}),
      },
      busy: false,
      errorMessage: null,
      needsConfiguration: false,
      retry,
    });

    await import("../src/renderer/main.tsx");

    const DesktopBootstrap = loadDesktopBootstrap();
    const tree = DesktopBootstrap();

    expect(getDesktopApiMock).toHaveBeenCalledTimes(1);

    expect(isReactElementLike(tree)).toBe(true);
    expect((tree as ReactElementLike).type).toBe(OperatorUiHostProviderMock);
    expect((tree as ReactElementLike).props.value).toEqual({ kind: "desktop", api: desktopApi });

    const operatorUiAppElement = unwrapSingleChild((tree as ReactElementLike).props.children);
    expect(isReactElementLike(operatorUiAppElement)).toBe(true);
    expect((operatorUiAppElement as ReactElementLike).type).toBe(OperatorUiAppMock);
    expect((operatorUiAppElement as ReactElementLike).props.core).toBe(core);
    expect((operatorUiAppElement as ReactElementLike).props.mode).toBe("desktop");
    expect((operatorUiAppElement as ReactElementLike).props.elevatedModeController).not.toBeNull();
    expect((operatorUiAppElement as ReactElementLike).props.onReloadPage).toBe(retry);
  });

  it("shows an error state and wires Retry to operatorCore.retry", async () => {
    const retry = vi.fn();
    setDesktopOperatorCoreState({
      core: null,
      elevatedModeController: null,
      busy: false,
      errorMessage: "boom",
      needsConfiguration: false,
      retry,
    });

    await import("../src/renderer/main.tsx");

    const DesktopBootstrap = loadDesktopBootstrap();
    const tree = DesktopBootstrap();

    const alert = findFirstElement(tree, (el) => el.type === AlertMock);
    if (!alert) {
      throw new Error("Alert element not found.");
    }
    expect(alert.props.title).toBe("Operator connection unavailable");
    expect(alert.props.description).toBe("boom");

    const button = findFirstElement(tree, (el) => el.type === ButtonMock);
    if (!button) {
      throw new Error("Retry button not found.");
    }
    expect(collectText(button.props.children)).toContain("Retry");
    const onClick = button.props.onClick;
    expect(onClick).toBeTypeOf("function");

    (onClick as () => void)();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows the desktop setup wizard when configuration is missing", async () => {
    const retry = vi.fn();
    setDesktopOperatorCoreState({
      core: null,
      elevatedModeController: null,
      busy: false,
      errorMessage: null,
      needsConfiguration: true,
      retry,
    });

    await import("../src/renderer/main.tsx");

    const DesktopBootstrap = loadDesktopBootstrap();
    const tree = DesktopBootstrap();

    expect(isReactElementLike(tree)).toBe(true);
    expect(typeof (tree as ReactElementLike).type).toBe("function");
    expect(((tree as ReactElementLike).type as { name?: unknown }).name).toBe("DesktopSetupWizard");
    expect((tree as ReactElementLike).props.onConfigured).toBe(retry);
  });
});
