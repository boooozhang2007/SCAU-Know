declare module "word-extractor" {
  export interface ExtractedWordDocument {
    getBody(): string;
    getHeaders(options?: { includeFooters?: boolean }): string;
    getFooters(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getAnnotations(): string;
    getTextboxes(): string;
  }

  export default class WordExtractor {
    extract(document: string | Buffer): Promise<ExtractedWordDocument>;
  }
}
