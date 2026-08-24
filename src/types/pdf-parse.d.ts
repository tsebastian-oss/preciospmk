type PdfParseResult = { text: string; numpages?: number; info?: Record<string, unknown>; metadata?: unknown };
declare module "pdf-parse" {
  export default function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;
}
declare module "pdf-parse/lib/pdf-parse.js" {
  export default function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;
}
