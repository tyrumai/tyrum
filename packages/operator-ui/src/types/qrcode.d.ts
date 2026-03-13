declare module "qrcode" {
  export type QRCodeToStringOptions = {
    type?: "svg" | "utf8" | "terminal";
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    margin?: number;
    width?: number;
  };

  export function toString(text: string, options?: QRCodeToStringOptions): Promise<string>;

  const QRCode: {
    toString: typeof toString;
  };

  export default QRCode;
}
