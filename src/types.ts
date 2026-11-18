export type SourceType = 'bundled' | 'drive';

export type SourceScope = 'all' | 'drive' | 'bundled';

export interface IndexedDocumentMeta {
  docId: string;
  docName: string;
  shortName: string;
  sourceType: SourceType;
  mimeType: string;
  pageCount: number;
  charCount: number;
  status: 'indexed' | 'unsupported' | 'error';
  note?: string;
  modifiedTime?: string;
  sizeBytes?: number;
  folderPath?: string;
  webViewLink?: string;
  localPdfUrl?: string;
}

export interface DriveFolderInfo {
  folderId: string;
  folderName: string;
  folderUrl: string;
  syncedAt: string;
  docs: IndexedDocumentMeta[];
}

export interface Citation {
  docId: string;
  docName: string;
  shortName: string;
  sourceType: SourceType;
  pageNumber: number;
  snippet: string;
  webViewLink?: string;
  localPdfUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  driveConnected?: boolean;
  driveDocsCount?: number;
  bundledDocsCount?: number;
  driveSyncWarning?: string | null;
  error?: string;
  isStreaming?: boolean;
}

export interface SearchHit {
  docId: string;
  docName: string;
  shortName: string;
  sourceType: SourceType;
  pageNumber: number;
  score: number;
  matchedTerms: string[];
  snippet: string;
  webViewLink?: string;
  localPdfUrl?: string;
}

export interface InspectedPage {
  docId: string;
  docName: string;
  shortName: string;
  sourceType: SourceType;
  pageNumber: number;
  text: string;
  webViewLink?: string;
  localPdfUrl?: string;
  highlightQuery?: string;
}
