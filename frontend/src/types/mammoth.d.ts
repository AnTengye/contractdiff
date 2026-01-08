// Type declarations for mammoth
declare module 'mammoth' {
  interface Message {
    type: string;
    message: string;
  }

  interface ConversionResult {
    value: string;
    messages: Message[];
  }

  interface ConvertOptions {
    styleMap?: string[];
  }

  interface InputData {
    arrayBuffer: ArrayBuffer;
  }

  export function convertToHtml(
    input: InputData,
    options?: ConvertOptions
  ): Promise<ConversionResult>;

  export { Message };
}
