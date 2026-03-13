declare module "@capacitor/app" {
  export type AppLaunchUrl = {
    url?: string;
  };

  export type AppState = {
    isActive: boolean;
  };

  export type PluginListenerHandle = {
    remove(): Promise<void>;
  };

  export const App: {
    getLaunchUrl(): Promise<AppLaunchUrl | undefined>;
    getState(): Promise<AppState>;
    addListener(
      eventName: "appUrlOpen",
      listener: (event: { url: string }) => void,
    ): Promise<PluginListenerHandle>;
    addListener(
      eventName: "appStateChange",
      listener: (state: AppState) => void,
    ): Promise<PluginListenerHandle>;
  };
}

declare module "@capacitor/barcode-scanner" {
  export const CapacitorBarcodeScannerTypeHint: {
    QR_CODE: "QR_CODE";
  };

  export const CapacitorBarcodeScanner: {
    scanBarcode(input: {
      hint: string;
      scanInstructions?: string;
      scanButton?: boolean;
    }): Promise<{ ScanResult: string }>;
  };
}

declare module "@capacitor/clipboard" {
  export const Clipboard: {
    write(input: { string: string }): Promise<void>;
  };
}

declare module "@capacitor/device" {
  export type DeviceInfo = {
    name?: string;
    manufacturer?: string;
    model?: string;
    operatingSystem?: string;
    osVersion?: string;
  };

  export const Device: {
    getInfo(): Promise<DeviceInfo>;
  };
}

declare module "@capacitor/network" {
  export type ConnectionStatus = {
    connected: boolean;
    connectionType?: string;
  };

  export type PluginListenerHandle = {
    remove(): Promise<void>;
  };

  export const Network: {
    getStatus(): Promise<ConnectionStatus>;
    addListener(
      eventName: "networkStatusChange",
      listener: (status: ConnectionStatus) => void,
    ): Promise<PluginListenerHandle>;
  };
}
