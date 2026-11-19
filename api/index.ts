import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import express from 'express';
import type { Request, Response } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DRIVE_FOLDER_ID = '126RoT_pKljrBsqS564Z9uxXE7Tq42ehf';
const PRIMARY_INDEX_PATH = path.join(
  process.cwd(),
  'data',
  'cbs_manual_2026_index.json',
);
const INDEX_CACHE_PATH = '/tmp/cbs_manual_2026_index_v1.json';

export type SourceType = 'bundled' | 'drive';

export interface IndexedPage {
  docId: string;
  docName: string;
  shortName: string;
  sourceType: SourceType;
  pageNumber: number;
  text: string;
  lowerText: string;
  webViewLink?: string;
  localPdfUrl?: string;
}

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

interface DriveFolderState {
  folderId: string;
  folderName: string;
  folderUrl: string;
  syncedAt: string;
  docs: IndexedDocumentMeta[];
  pages: IndexedPage[];
}

interface ScoredPage {
  page: IndexedPage;
  score: number;
  matchedTerms: string[];
}

interface BundledManualSpec {
  docId: string;
  docName: string;
  shortName: string;
  localPdfUrl: string;
}

const BUNDLED_MANUALS: BundledManualSpec[] = [
  {
    docId: 'bundled-part-1',
    docName: 'POSB CBS Manual 2026 — Part I (Chapters 1–22, Rules 1–179)',
    shortName: 'CBS Manual 2026 Part-I',
    localPdfUrl: '/assets/aistudio/POSB_CBS_Manual_2026_Part_1__1__14291118.pdf',
  },
  {
    docId: 'bundled-part-2',
    docName: 'POSB CBS Manual 2026 — Part II (Appendices I–XXIX)',
    shortName: 'CBS Manual 2026 Part-II',
    localPdfUrl: '/assets/aistudio/POSB_CBS_Manual_2026_Part_2_bc45b28c.pdf',
  },
];

let bundledDocs: IndexedDocumentMeta[] = [];
let bundledPages: IndexedPage[] = [];
let bundledIndexingPromise: Promise<void> | null = null;
let bundledIndexError: string | null = null;

const driveFolderStore = new Map<string, DriveFolderState>();
const driveFileContentCache = new Map<
  string,
  { meta: IndexedDocumentMeta; pages: IndexedPage[] }
>();
const driveUserKeyCache = new Map<string, { key: string; expiresAt: number }>();
const inFlightDriveSyncs = new Map<
  string,
  Promise<{ userKey: string; state: DriveFolderState }>
>();
const failedModelKeys = new Set<string>();


const answerCache = new Map<
  string,
  {
    answer: string;
    citations: Array<{
      docId: string;
      docName: string;
      shortName: string;
      sourceType: SourceType;
      pageNumber: number;
      snippet: string;
      webViewLink?: string;
      localPdfUrl?: string;
    }>;
  }
>();

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'please',
  'should',
  'tell',
  'that',
  'the',
  'their',
  'this',
  'to',
  'under',
  'what',
  'when',
  'where',
  'which',
  'who',
  'will',
  'with',
  'explain',
  'describe',
  'list',
  'give',
  'about',
  'manual',
  'posb',
  'cbs',
  'finacle',
  'menu',
  'code',
]);

let cachedAiClient: { apiKey: string; client: GoogleGenAI } | null = null;
function getAiClient(apiKey: string): GoogleGenAI {
  if (!cachedAiClient || cachedAiClient.apiKey !== apiKey) {
    cachedAiClient = {
      apiKey,
      client: new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      }),
    };
  }
  return cachedAiClient.client;
}

function cleanExtractedText(raw: string): string {
  return raw
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitLongTextIntoPages(
  docId: string,
  docName: string,
  shortName: string,
  sourceType: SourceType,
  text: string,
  extra?: { webViewLink?: string; localPdfUrl?: string },
): IndexedPage[] {
  const cleaned = cleanExtractedText(text);
  if (!cleaned) {
    return [];
  }
  const maxChunkChars = 3200;
  const paragraphs = cleaned.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > maxChunkChars && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.map((chunk, idx) => ({
    docId,
    docName,
    shortName,
    sourceType,
    pageNumber: idx + 1,
    text: chunk,
    lowerText: chunk.toLowerCase(),
    webViewLink: extra?.webViewLink,
    localPdfUrl: extra?.localPdfUrl,
  }));
}

function extractTextFromDocxBuffer(buf: Buffer): string {
  try {
    let offset = 0;
    const xmlSegments: string[] = [];
    while (offset + 30 <= buf.length) {
      const sig = buf.readUInt32LE(offset);
      if (sig !== 0x04034b50) {
        break;
      }
      const compressionMethod = buf.readUInt16LE(offset + 8);
      const compressedSize = buf.readUInt32LE(offset + 18);
      const fileNameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      const nameStart = offset + 30;
      const nameEnd = nameStart + fileNameLen;
      const fileName = buf.subarray(nameStart, nameEnd).toString('utf8');
      const dataStart = nameEnd + extraLen;
      const dataEnd = dataStart + compressedSize;

      if (dataEnd > buf.length) {
        break;
      }

      if (
        fileName === 'word/document.xml' ||
        fileName.startsWith('word/header') ||
        fileName.startsWith('word/footer')
      ) {
        const compressedData = buf.subarray(dataStart, dataEnd);
        let xmlBuffer: Buffer;
        if (compressionMethod === 0) {
          xmlBuffer = compressedData;
        } else if (compressionMethod === 8) {
          xmlBuffer = zlib.inflateRawSync(compressedData);
        } else {
          xmlBuffer = Buffer.alloc(0);
        }
        if (xmlBuffer.length > 0) {
          const xmlText = xmlBuffer
            .toString('utf8')
            .replace(/<\/w:p>/g, '\n')
            .replace(/<\/w:tr>/g, '\n')
            .replace(/<\/w:tc>/g, ' | ')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
          xmlSegments.push(xmlText);
        }
      }
      offset = dataEnd;
    }
    return cleanExtractedText(xmlSegments.join('\n\n'));
  } catch {
    return '';
  }
}

async function resolveProjectFilePath(relativePath: string): Promise<string> {
  const candidates = [
    path.join(process.cwd(), relativePath),
    path.join(__dirname, '..', relativePath),
    path.join(__dirname, relativePath),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate
    }
  }
  return candidates[0];
}

function hydrateCachedIndex(cached: {
  docs?: IndexedDocumentMeta[];
  pages?: Array<{
    docId: string;
    docName: string;
    shortName: string;
    sourceType: SourceType;
    pageNumber: number;
    text: string;
    localPdfUrl?: string;
  }>;
}): boolean {
  if (
    cached.docs?.length === BUNDLED_MANUALS.length &&
    cached.pages &&
    cached.pages.length > 100
  ) {
    bundledDocs = cached.docs.map((d) => ({
      ...d,
      localPdfUrl:
        d.localPdfUrl ||
        (d.docId === 'bundled-part-1'
          ? '/assets/aistudio/POSB_CBS_Manual_2026_Part_1__1__14291118.pdf'
          : '/assets/aistudio/POSB_CBS_Manual_2026_Part_2_bc45b28c.pdf'),
    }));
    bundledPages = cached.pages.map((p) => ({
      ...p,
      lowerText: p.text.toLowerCase(),
      localPdfUrl:
        p.localPdfUrl ||
        (p.docId === 'bundled-part-1'
          ? '/assets/aistudio/POSB_CBS_Manual_2026_Part_1__1__14291118.pdf'
          : '/assets/aistudio/POSB_CBS_Manual_2026_Part_2_bc45b28c.pdf'),
    }));
    bundledIndexError = null;
    return true;
  }
  return false;
}

async function indexBundledManuals(baseUrl?: string): Promise<void> {
  try {
    // 1. Direct literal path read so Vercel NFT traces data/cbs_manual_2026_index.json
    try {
      const primaryRaw = await fs.readFile(PRIMARY_INDEX_PATH, 'utf8');
      if (hydrateCachedIndex(JSON.parse(primaryRaw))) {
        console.log(
          `[CBS Index] Loaded ${bundledPages.length} saved manual pages from ${PRIMARY_INDEX_PATH}.`,
        );
        return;
      }
    } catch {
      // Check secondary paths
    }

    const secondaryCandidates = [
      path.join(__dirname, '..', 'data', 'cbs_manual_2026_index.json'),
      path.join(__dirname, 'data', 'cbs_manual_2026_index.json'),
      path.join(process.cwd(), 'dist', 'data', 'cbs_manual_2026_index.json'),
      INDEX_CACHE_PATH,
    ];

    for (const cacheCandidate of secondaryCandidates) {
      try {
        const cachedRaw = await fs.readFile(cacheCandidate, 'utf8');
        if (hydrateCachedIndex(JSON.parse(cachedRaw))) {
          console.log(
            `[CBS Index] Loaded ${bundledPages.length} saved manual pages from ${cacheCandidate}.`,
          );
          return;
        }
      } catch {
        // Try next candidate
      }
    }

    // 2. Fallback for serverless environments where static files are hosted on CDN
    const fallbackOrigin =
      baseUrl ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
    if (fallbackOrigin) {
      try {
        const res = await fetch(
          `${fallbackOrigin}/data/cbs_manual_2026_index.json`,
        );
        if (res.ok) {
          const cached = await res.json();
          if (hydrateCachedIndex(cached)) {
            console.log(
              `[CBS Index] Loaded ${bundledPages.length} saved manual pages from CDN (${fallbackOrigin}).`,
            );
            return;
          }
        }
      } catch {
        // Fall through to PDF extraction
      }
    }

    // 3. Lazy-load unpdf only if fresh PDF extraction is required
    const { extractText } = await import('unpdf');
    const docs: IndexedDocumentMeta[] = [];
    const pages: IndexedPage[] = [];

    for (const spec of BUNDLED_MANUALS) {
      const resolvedPdfPath = await resolveProjectFilePath(
        `public${spec.localPdfUrl}`,
      );
      const fileBytes = await fs.readFile(resolvedPdfPath);
      const stat = await fs.stat(resolvedPdfPath);
      const { totalPages, text } = await extractText(new Uint8Array(fileBytes), {
        mergePages: false,
      });

      let totalChars = 0;
      const pageList = Array.isArray(text) ? text : [String(text)];
      pageList.forEach((rawPageText, index) => {
        const cleaned = cleanExtractedText(rawPageText);
        totalChars += cleaned.length;
        pages.push({
          docId: spec.docId,
          docName: spec.docName,
          shortName: spec.shortName,
          sourceType: 'bundled',
          pageNumber: index + 1,
          text: cleaned,
          lowerText: cleaned.toLowerCase(),
          localPdfUrl: spec.localPdfUrl,
        });
      });

      docs.push({
        docId: spec.docId,
        docName: spec.docName,
        shortName: spec.shortName,
        sourceType: 'bundled',
        mimeType: 'application/pdf',
        pageCount: totalPages || pageList.length,
        charCount: totalChars,
        sizeBytes: stat.size,
        status: 'indexed',
        localPdfUrl: spec.localPdfUrl,
      });
    }

    bundledDocs = docs;
    bundledPages = pages;
    bundledIndexError = null;

    try {
      await fs.writeFile(
        INDEX_CACHE_PATH,
        JSON.stringify({
          docs,
          pages: pages.map(({ lowerText: _omit, ...rest }) => rest),
        }),
        'utf8',
      );
    } catch {
      // Ignore /tmp write warnings
    }
  } catch (err) {
    bundledIndexError = err instanceof Error ? err.message : String(err);
    console.error('[CBS Index] Failed to index bundled PDFs:', err);
  }
}

function getRequestOrigin(req?: Request): string | undefined {
  if (!req) return undefined;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return undefined;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${Array.isArray(proto) ? proto[0] : proto}://${Array.isArray(host) ? host[0] : host}`;
}

export function ensureBundledIndexed(req?: Request): Promise<void> {
  if (bundledPages.length > 0) {
    return Promise.resolve();
  }
  if (!bundledIndexingPromise) {
    bundledIndexingPromise = indexBundledManuals(getRequestOrigin(req)).finally(
      () => {
        if (bundledPages.length === 0) {
          bundledIndexingPromise = null;
        }
      },
    );
  }
  return bundledIndexingPromise;
}

export function extractDriveFolderId(input?: string): string {
  if (!input || !input.trim()) {
    return DEFAULT_DRIVE_FOLDER_ID;
  }
  const trimmed = input.trim();
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch?.[1]) {
    return folderMatch[1];
  }
  const fileMatch = trimmed.match(
    /\/(?:file|document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/,
  );
  if (fileMatch?.[1]) {
    return fileMatch[1];
  }
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch?.[1]) {
    return idParamMatch[1];
  }
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, '') || DEFAULT_DRIVE_FOLDER_ID;
}

function normalizeDriveResourceIds(inputs?: string | string[]): string[] {
  const rawList = Array.isArray(inputs)
    ? inputs
    : typeof inputs === 'string'
      ? inputs.split(',')
      : [];
  const ids = rawList
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => extractDriveFolderId(v));
  const unique = Array.from(new Set(ids));
  return unique.length > 0 ? unique : [DEFAULT_DRIVE_FOLDER_ID];
}

function buildDriveStoreKey(userKey: string, resourceIds: string[]): string {
  const canonical = [...resourceIds].sort().join(',');
  return `${userKey}:${canonical}`;
}

function hashTokenForKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
}

async function resolveDriveUserKey(accessToken: string): Promise<string> {
  const tokenHash = hashTokenForKey(accessToken);
  const cached = driveUserKeyCache.get(tokenHash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      },
    ).finally(() => clearTimeout(timer));
    if (res.ok) {
      const data = (await res.json()) as { user?: { emailAddress?: string } };
      if (data.user?.emailAddress) {
        const key = data.user.emailAddress.toLowerCase();
        driveUserKeyCache.set(tokenHash, {
          key,
          expiresAt: Date.now() + 30 * 60 * 1000,
        });
        return key;
      }
    }
  } catch {
    // Fall back to token hash
  }
  const fallbackKey = `tok_${tokenHash}`;
  driveUserKeyCache.set(tokenHash, {
    key: fallbackKey,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return fallbackKey;
}

interface DriveApiFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  shortcutDetails?: {
    targetId?: string;
    targetMimeType?: string;
  };
}

async function listDriveFilesRecursive(
  folderId: string,
  accessToken: string,
  prefix = '',
  depth = 0,
  collected: Array<{ file: DriveApiFile; folderPath: string }> = [],
): Promise<Array<{ file: DriveApiFile; folderPath: string }>> {
  if (depth > 3 || collected.length >= 60) {
    return collected;
  }

  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields:
        'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,shortcutDetails)',
      pageSize: '100',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      orderBy: 'folder,name',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Google Drive API error (${res.status}): ${errBody}`);
    }

    const data = (await res.json()) as {
      nextPageToken?: string;
      files?: DriveApiFile[];
    };

    for (const item of data.files ?? []) {
      if (collected.length >= 60) break;

      const resolvedId =
        item.mimeType === 'application/vnd.google-apps.shortcut' &&
        item.shortcutDetails?.targetId
          ? item.shortcutDetails.targetId
          : item.id;
      const resolvedMime =
        item.mimeType === 'application/vnd.google-apps.shortcut' &&
        item.shortcutDetails?.targetMimeType
          ? item.shortcutDetails.targetMimeType
          : item.mimeType;

      const resolvedItem: DriveApiFile = {
        ...item,
        id: resolvedId,
        mimeType: resolvedMime,
      };

      if (resolvedMime === 'application/vnd.google-apps.folder') {
        const subPath = prefix ? `${prefix}/${item.name}` : item.name;
        await listDriveFilesRecursive(
          resolvedId,
          accessToken,
          subPath,
          depth + 1,
          collected,
        );
      } else {
        collected.push({ file: resolvedItem, folderPath: prefix });
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken && collected.length < 60);

  return collected;
}

async function fetchAndIndexDriveFile(
  entry: { file: DriveApiFile; folderPath: string },
  accessToken: string,
): Promise<{ meta: IndexedDocumentMeta; pages: IndexedPage[] }> {
  const { file, folderPath } = entry;
  const cacheKey = `${file.id}:${file.modifiedTime ?? 'none'}`;
  const cached = driveFileContentCache.get(cacheKey);
  if (cached) {
    return {
      meta: { ...cached.meta, folderPath },
      pages: cached.pages,
    };
  }

  const docId = `drive-${file.id}`;
  const shortName = file.name;
  const docName = folderPath ? `${folderPath}/${file.name}` : file.name;
  const sizeBytes = file.size ? Number(file.size) : undefined;

  const baseMeta: IndexedDocumentMeta = {
    docId,
    docName,
    shortName,
    sourceType: 'drive',
    mimeType: file.mimeType,
    pageCount: 0,
    charCount: 0,
    status: 'unsupported',
    modifiedTime: file.modifiedTime,
    sizeBytes,
    folderPath,
    webViewLink: file.webViewLink,
  };

  try {
    if (
      file.mimeType === 'application/vnd.google-apps.document' ||
      file.mimeType === 'application/vnd.google-apps.presentation'
    ) {
      const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=text/plain`;
      const res = await fetch(exportUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`Export failed (${res.status})`);
      }
      const text = await res.text();
      const pages = splitLongTextIntoPages(
        docId,
        docName,
        shortName,
        'drive',
        text,
        { webViewLink: file.webViewLink },
      );
      const result = {
        meta: {
          ...baseMeta,
          status: 'indexed' as const,
          pageCount: pages.length || 1,
          charCount: text.length,
        },
        pages,
      };
      driveFileContentCache.set(cacheKey, result);
      return result;
    }

    if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
      const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=text/csv`;
      const res = await fetch(exportUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`Sheet export failed (${res.status})`);
      }
      const csvText = await res.text();
      const pages = splitLongTextIntoPages(
        docId,
        docName,
        shortName,
        'drive',
        csvText,
        { webViewLink: file.webViewLink },
      );
      const result = {
        meta: {
          ...baseMeta,
          status: 'indexed' as const,
          pageCount: pages.length || 1,
          charCount: csvText.length,
        },
        pages,
      };
      driveFileContentCache.set(cacheKey, result);
      return result;
    }

    if (file.mimeType === 'application/pdf') {
      const lowerName = file.name.toLowerCase();
      const matchedBundledId =
        sizeBytes === 6028085 ||
        (lowerName.includes('cbs') &&
          lowerName.includes('manual') &&
          /part[\s_-]*1\b|part[\s_-]*i\b/.test(lowerName))
          ? 'bundled-part-1'
          : sizeBytes === 14312184 ||
              (lowerName.includes('cbs') &&
                lowerName.includes('manual') &&
                /part[\s_-]*2\b|part[\s_-]*ii\b/.test(lowerName))
            ? 'bundled-part-2'
            : null;

      if (matchedBundledId && bundledPages.length > 0) {
        const templatePages = bundledPages.filter(
          (p) => p.docId === matchedBundledId,
        );
        if (templatePages.length > 0) {
          let totalChars = 0;
          const pages: IndexedPage[] = templatePages.map((tp) => {
            totalChars += tp.text.length;
            return {
              docId,
              docName,
              shortName,
              sourceType: 'drive',
              pageNumber: tp.pageNumber,
              text: tp.text,
              lowerText: tp.lowerText,
              webViewLink: file.webViewLink,
              localPdfUrl: tp.localPdfUrl,
            };
          });
          const result = {
            meta: {
              ...baseMeta,
              status: 'indexed' as const,
              pageCount: pages.length,
              charCount: totalChars,
              localPdfUrl: templatePages[0].localPdfUrl,
            },
            pages,
          };
          driveFileContentCache.set(cacheKey, result);
          return result;
        }
      }

      if (sizeBytes && sizeBytes > 60 * 1024 * 1024) {
        return {
          meta: {
            ...baseMeta,
            status: 'error',
            note: 'File exceeds 60 MB limit for in-memory extraction.',
          },
          pages: [],
        };
      }
      const dlUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`;
      const res = await fetch(dlUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`PDF download failed (${res.status})`);
      }
      const { extractText } = await import('unpdf');
      const arrayBuf = await res.arrayBuffer();
      const { totalPages, text } = await extractText(new Uint8Array(arrayBuf), {
        mergePages: false,
      });
      const rawPages = Array.isArray(text) ? text : [String(text)];
      const pages: IndexedPage[] = [];
      let totalChars = 0;

      rawPages.forEach((pText, idx) => {
        const cleaned = cleanExtractedText(pText);
        totalChars += cleaned.length;
        pages.push({
          docId,
          docName,
          shortName,
          sourceType: 'drive',
          pageNumber: idx + 1,
          text: cleaned,
          lowerText: cleaned.toLowerCase(),
          webViewLink: file.webViewLink,
        });
      });

      const result = {
        meta: {
          ...baseMeta,
          status: 'indexed' as const,
          pageCount: totalPages || rawPages.length,
          charCount: totalChars,
        },
        pages,
      };
      driveFileContentCache.set(cacheKey, result);
      return result;
    }

    if (
      file.mimeType.startsWith('text/') ||
      file.mimeType === 'application/json' ||
      file.mimeType === 'application/csv'
    ) {
      const dlUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`;
      const res = await fetch(dlUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`Download failed (${res.status})`);
      }
      const txt = await res.text();
      const pages = splitLongTextIntoPages(
        docId,
        docName,
        shortName,
        'drive',
        txt,
        { webViewLink: file.webViewLink },
      );
      const result = {
        meta: {
          ...baseMeta,
          status: 'indexed' as const,
          pageCount: pages.length || 1,
          charCount: txt.length,
        },
        pages,
      };
      driveFileContentCache.set(cacheKey, result);
      return result;
    }

    if (
      file.mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const dlUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`;
      const res = await fetch(dlUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`DOCX download failed (${res.status})`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const extracted = extractTextFromDocxBuffer(buf);
      if (!extracted) {
        return {
          meta: {
            ...baseMeta,
            status: 'unsupported',
            note: 'Could not extract readable text from DOCX.',
          },
          pages: [],
        };
      }
      const pages = splitLongTextIntoPages(
        docId,
        docName,
        shortName,
        'drive',
        extracted,
        { webViewLink: file.webViewLink },
      );
      const result = {
        meta: {
          ...baseMeta,
          status: 'indexed' as const,
          pageCount: pages.length || 1,
          charCount: extracted.length,
        },
        pages,
      };
      driveFileContentCache.set(cacheKey, result);
      return result;
    }

    return {
      meta: {
        ...baseMeta,
        status: 'unsupported',
        note: `Unsupported file type (${file.mimeType})`,
      },
      pages: [],
    };
  } catch (err) {
    return {
      meta: {
        ...baseMeta,
        status: 'error',
        note:
          err instanceof Error ? err.message : 'Failed to extract file content',
      },
      pages: [],
    };
  }
}

async function syncDriveFolder(
  folderInputs: string | string[] | undefined,
  accessToken: string,
): Promise<{ userKey: string; state: DriveFolderState }> {
  const resourceIds = normalizeDriveResourceIds(folderInputs);
  const userKey = await resolveDriveUserKey(accessToken);

  const collectedEntries: Array<{ file: DriveApiFile; folderPath: string }> =
    [];
  const seenFileIds = new Set<string>();
  const folderNames: string[] = [];
  let primaryFolderUrl = `https://drive.google.com/drive/folders/${resourceIds[0]}`;

  for (const resId of resourceIds) {
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(resId)}?fields=id,name,mimeType,size,modifiedTime,webViewLink,shortcutDetails&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!metaRes.ok) {
      const errText = await metaRes.text();
      if (metaRes.status === 401) {
        throw new Error(
          'Google Drive session expired. Please sign in with Google again.',
        );
      }
      if (metaRes.status === 403 || metaRes.status === 404) {
        throw new Error(
          `Unable to access Google Drive link (${resId}). Verify the link is shared with your Google account.`,
        );
      }
      throw new Error(`Google Drive error (${metaRes.status}): ${errText}`);
    }

    const resMeta = (await metaRes.json()) as DriveApiFile;
    if (resMeta.name) {
      folderNames.push(resMeta.name);
    }
    if (resId === resourceIds[0] && resMeta.webViewLink) {
      primaryFolderUrl = resMeta.webViewLink;
    }

    const resolvedId =
      resMeta.mimeType === 'application/vnd.google-apps.shortcut' &&
      resMeta.shortcutDetails?.targetId
        ? resMeta.shortcutDetails.targetId
        : resMeta.id;
    const resolvedMime =
      resMeta.mimeType === 'application/vnd.google-apps.shortcut' &&
      resMeta.shortcutDetails?.targetMimeType
        ? resMeta.shortcutDetails.targetMimeType
        : resMeta.mimeType;

    if (resolvedMime === 'application/vnd.google-apps.folder') {
      const entries = await listDriveFilesRecursive(resolvedId, accessToken);
      for (const entry of entries) {
        if (!seenFileIds.has(entry.file.id)) {
          seenFileIds.add(entry.file.id);
          collectedEntries.push(entry);
        }
      }
    } else if (!seenFileIds.has(resolvedId)) {
      seenFileIds.add(resolvedId);
      collectedEntries.push({
        file: { ...resMeta, id: resolvedId, mimeType: resolvedMime },
        folderPath: '',
      });
    }
  }

  const docs: IndexedDocumentMeta[] = [];
  const pages: IndexedPage[] = [];
  const concurrency = 4;

  for (let i = 0; i < collectedEntries.length; i += concurrency) {
    const batch = collectedEntries.slice(i, i + concurrency);
    const settled = await Promise.all(
      batch.map((entry) => fetchAndIndexDriveFile(entry, accessToken)),
    );
    for (const item of settled) {
      docs.push(item.meta);
      pages.push(...item.pages);
    }
  }

  const state: DriveFolderState = {
    folderId: resourceIds.join(','),
    folderName:
      folderNames.length > 0
        ? Array.from(new Set(folderNames)).join(' + ')
        : 'CBS Manual Google Drive Folder',
    folderUrl: primaryFolderUrl,
    syncedAt: new Date().toISOString(),
    docs,
    pages,
  };

  driveFolderStore.set(buildDriveStoreKey(userKey, resourceIds), state);
  return { userKey, state };
}

function tokenizeQuery(query: string): {
  terms: string[];
  phrases: string[];
  codeTokens: string[];
  refTokens: string[];
} {
  const cleaned = query
    .replace(/[^\w\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const rawWords = cleaned.split(' ').filter(Boolean);
  const terms: string[] = [];
  const codeTokens: string[] = [];

  for (const w of rawWords) {
    const lower = w.toLowerCase();
    if (/^[A-Z0-9-]{3,12}$/.test(w) && /[A-Z]/.test(w)) {
      codeTokens.push(lower);
    }
    if (lower.length >= 2 && !STOPWORDS.has(lower)) {
      terms.push(lower);
    }
  }

  const refTokens: string[] = [];
  const refMatches = query.matchAll(
    /\b(rule|chapter|appendix|annexure|form|section|sb|para)\s*[-:]?\s*([a-z0-9]+)/gi,
  );
  for (const m of refMatches) {
    refTokens.push(`${m[1].toLowerCase()} ${m[2].toLowerCase()}`);
    refTokens.push(`${m[1].toLowerCase()}-${m[2].toLowerCase()}`);
  }

  const phrases: string[] = [];
  for (let i = 0; i < terms.length - 1; i++) {
    phrases.push(`${terms[i]} ${terms[i + 1]}`);
  }

  return {
    terms: Array.from(new Set(terms)),
    phrases: Array.from(new Set(phrases)),
    codeTokens: Array.from(new Set(codeTokens)),
    refTokens: Array.from(new Set(refTokens)),
  };
}

function retrieveRelevantPages(
  query: string,
  rawCandidatePages: IndexedPage[],
  maxPages = 10,
): ScoredPage[] {
  const seenContentKeys = new Set<string>();
  const candidatePages: IndexedPage[] = [];
  for (const p of rawCandidatePages) {
    const contentKey = `${p.pageNumber}:${p.lowerText.slice(0, 96)}`;
    if (!seenContentKeys.has(contentKey)) {
      seenContentKeys.add(contentKey);
      candidatePages.push(p);
    }
  }

  const { terms, phrases, codeTokens, refTokens } = tokenizeQuery(query);
  if (terms.length === 0 && refTokens.length === 0) {
    return candidatePages.slice(0, maxPages).map((page) => ({
      page,
      score: 1,
      matchedTerms: [],
    }));
  }

  const wantsMenuCode = /\b(menu|finacle|t-?code|command)\b/i.test(query);
  const menuCodeRegex = /\b(?:C|H|P|S|T)[A-Z]{3,7}\b/;
  const scored: ScoredPage[] = [];

  for (const page of candidatePages) {
    if (!page.text) continue;
    const text = page.lowerText;
    let score = 0;
    const matchedTerms: string[] = [];

    for (const term of terms) {
      let idx = text.indexOf(term);
      if (idx !== -1) {
        matchedTerms.push(term);
        let count = 0;
        while (idx !== -1 && count < 5) {
          count++;
          idx = text.indexOf(term, idx + term.length);
        }
        score += 3 + Math.min(count, 4) * 1.2;
        if (term.length >= 6) score += 1.5;
      }
    }

    if (matchedTerms.length === 0 && refTokens.length === 0 && codeTokens.length === 0) {
      continue;
    }

    for (const phrase of phrases) {
      if (text.includes(phrase)) {
        score += 9;
      }
    }

    for (const code of codeTokens) {
      if (text.includes(code)) {
        score += 14;
      }
    }

    for (const ref of refTokens) {
      if (text.includes(ref)) {
        score += 16;
      }
    }

    if (matchedTerms.length >= 2) {
      score += matchedTerms.length * matchedTerms.length * 1.3;
      if (wantsMenuCode && menuCodeRegex.test(page.text)) {
        score += 6;
      }
    }

    if (page.sourceType === 'drive' && score > 0) {
      score *= 1.12;
    }

    if (score > 0) {
      scored.push({ page, score, matchedTerms });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  const selectedMap = new Map<string, ScoredPage>();
  const topSeeds = scored.slice(0, maxPages);

  // Only look up adjacent pages for top 2 seeds to keep context tight and fast
  const neededAdjKeys = new Set<string>();
  for (let i = 0; i < Math.min(2, topSeeds.length); i++) {
    const p = topSeeds[i].page;
    neededAdjKeys.add(`${p.docId}:${p.pageNumber - 1}`);
    neededAdjKeys.add(`${p.docId}:${p.pageNumber + 1}`);
  }
  const adjLookup = new Map<string, IndexedPage>();
  if (neededAdjKeys.size > 0) {
    for (const p of candidatePages) {
      const k = `${p.docId}:${p.pageNumber}`;
      if (neededAdjKeys.has(k)) {
        adjLookup.set(k, p);
      }
    }
  }

  for (let i = 0; i < topSeeds.length; i++) {
    const item = topSeeds[i];
    const key = `${item.page.docId}:${item.page.pageNumber}`;
    if (!selectedMap.has(key)) {
      selectedMap.set(key, item);
    }
    if (i < 2) {
      for (const offset of [-1, 1]) {
        const adjKey = `${item.page.docId}:${item.page.pageNumber + offset}`;
        const adjPage = adjLookup.get(adjKey);
        if (adjPage && !selectedMap.has(adjKey) && selectedMap.size < maxPages + 2) {
          selectedMap.set(adjKey, {
            page: adjPage,
            score: item.score * 0.5,
            matchedTerms: item.matchedTerms,
          });
        }
      }
    }
    if (selectedMap.size >= maxPages) break;
  }

  return Array.from(selectedMap.values()).sort((a, b) => b.score - a.score);
}

function buildSnippet(text: string, matchedTerms: string[]): string {
  if (!text) return '';
  const lower = text.toLowerCase();
  let firstPos = -1;
  for (const term of matchedTerms) {
    const pos = lower.indexOf(term);
    if (pos !== -1 && (firstPos === -1 || pos < firstPos)) {
      firstPos = pos;
    }
  }
  if (firstPos === -1) {
    return text.slice(0, 260).replace(/\s+/g, ' ').trim();
  }
  const start = Math.max(0, firstPos - 90);
  const end = Math.min(text.length, firstPos + 210);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

function buildDirectManualAnswer(
  question: string,
  scoredHits: ScoredPage[],
): string {
  if (scoredHits.length === 0) {
    return 'No matching sections were found in POSB CBS Manual 2026 (Part-I & Part-II) for this query. Try searching by Finacle menu code (e.g., `CASBAO`, `CRDP`), scheme name (`SB`, `RD`, `TD`, `MIS`, `SCSS`, `PPF`, `SSA`, `MSSC`), or rule number.';
  }

  const topHits = scoredHits.slice(0, 5);
  const menuSet = new Set<string>();
  const formSet = new Set<string>();

  const commonMenus =
    /\b(CASBAO|CASBAC|CMISAOP|CSCCAOP|CPPFAOP|CRDCAAC|CTDAOP|CCIF|CMRC|HFINRPT|HAFI|HTM|HCASHDEP|HCASHWD|HXFER|HCAAC|HCAACTD|HCCA|HLien|HALM|HCRT|CSBCO|CRDP|CINT|HISIA|HSSI|HINTTM)\b/g;
  const commonForms =
    /\b(SB-(?:AOF|7|7A|7B|7C|103|84|5|5A)|Form[-\s]?(?:15G|15H|60|1|2|3)|Section\s+(?:194A|194N|194H|194EE))\b/gi;

  for (const hit of topHits) {
    for (const m of hit.page.text.matchAll(commonMenus)) {
      menuSet.add(m[1].toUpperCase());
    }
    for (const f of hit.page.text.matchAll(commonForms)) {
      formSet.add(f[1].replace(/\s+/g, ' ').trim());
    }
  }

  const lines: string[] = [];
  lines.push(
    `### POSB CBS Manual 2026 Reference — ${question.length > 72 ? question.slice(0, 72) + '…' : question}`,
  );
  lines.push('');

  if (menuSet.size > 0 || formSet.size > 0) {
    const badges: string[] = [];
    if (menuSet.size > 0) {
      badges.push(
        `**Finacle Menus:** ${Array.from(menuSet)
          .slice(0, 8)
          .map((c) => `\`${c}\``)
          .join(', ')}`,
      );
    }
    if (formSet.size > 0) {
      badges.push(
        `**Forms / Sections:** ${Array.from(formSet)
          .slice(0, 8)
          .map((f) => `\`${f}\``)
          .join(', ')}`,
      );
    }
    lines.push(badges.join(' · '));
    lines.push('');
  }

  for (let i = 0; i < topHits.length; i++) {
    const { page, matchedTerms } = topHits[i];
    const paragraphs = page.text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 25 && !/^\d+$/.test(l));

    const matchingParas = paragraphs.filter((p) => {
      const lower = p.toLowerCase();
      return matchedTerms.some((t) => lower.includes(t));
    });

    const selectedLines = (
      matchingParas.length >= 2
        ? matchingParas.slice(0, 6)
        : paragraphs.slice(0, 6)
    ).map((l) =>
      l.replace(
        /\b(CASBAO|CASBAC|CMISAOP|CSCCAOP|CPPFAOP|CRDCAAC|CTDAOP|CCIF|CMRC|HFINRPT|HAFI|HTM|HCASHDEP|HCASHWD|HXFER|HCAAC|HCAACTD|HCCA|CSBCO|CRDP|SB-AOF|SB-7|SB-103)\b/g,
        '`$1`',
      ),
    );

    if (selectedLines.length === 0) continue;

    lines.push(
      `#### ${i + 1}. **[${page.shortName}, Page ${page.pageNumber}]**`,
    );
    for (const item of selectedLines) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  lines.push(
    '*Tip: Click any referenced page card below to inspect the full manual page or open the PDF directly.*',
  );

  return lines.join('\n');
}

export const app = express();
app.use(express.json({ limit: '2mb' }));

app.use(express.static(path.join(process.cwd(), 'public')));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/data', express.static(path.join(process.cwd(), 'data')));

ensureBundledIndexed();

app.get('/api/health', async (req: Request, res: Response) => {
  try {
    await ensureBundledIndexed(req);
    res.json({
      ok: true,
      bundledIndexed: bundledPages.length > 0,
      bundledPageCount: bundledPages.length,
      bundledIndexError,
    });
  } catch (err) {
    res.status(200).json({
      ok: false,
      bundledIndexed: false,
      bundledPageCount: 0,
      bundledIndexError: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get('/api/sources', async (req: Request, res: Response) => {
  try {
    await ensureBundledIndexed(req);
    const resourceIds = normalizeDriveResourceIds(
      typeof req.query.folderId === 'string' ? req.query.folderId : undefined,
    );
    const authHeader = req.headers.authorization;
    let driveState: DriveFolderState | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token) {
        const userKey = await resolveDriveUserKey(token);
        driveState =
          driveFolderStore.get(buildDriveStoreKey(userKey, resourceIds)) ??
          null;
      }
    }

    res.json({
      defaultFolderId: DEFAULT_DRIVE_FOLDER_ID,
      bundledDocs,
      bundledIndexError,
      driveFolder: driveState
        ? {
            folderId: driveState.folderId,
            folderName: driveState.folderName,
            folderUrl: driveState.folderUrl,
            syncedAt: driveState.syncedAt,
            docs: driveState.docs,
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load sources.',
    });
  }
});

app.post('/api/drive/sync', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Google sign-in required to read files from Google Drive.',
    });
    return;
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Missing Google Drive access token.' });
    return;
  }

  const folderInputs = Array.isArray(req.body?.folderInputs)
    ? (req.body.folderInputs as string[])
    : typeof req.body?.folderInput === 'string'
      ? req.body.folderInput
      : DEFAULT_DRIVE_FOLDER_ID;

  try {
    const { state } = await syncDriveFolder(folderInputs, token);
    res.json({
      folderId: state.folderId,
      folderName: state.folderName,
      folderUrl: state.folderUrl,
      syncedAt: state.syncedAt,
      docs: state.docs,
      totalPagesIndexed: state.pages.length,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to sync Google Drive folder.';
    const status = message.toLowerCase().includes('expired') ? 401 : 400;
    res.status(status).json({ error: message });
  }
});

app.get('/api/search', async (req: Request, res: Response) => {
  try {
    await ensureBundledIndexed(req);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const resourceIds = normalizeDriveResourceIds(
      typeof req.query.folderId === 'string' ? req.query.folderId : undefined,
    );
    const scope =
      typeof req.query.scope === 'string' ? req.query.scope : 'all';

    if (!q) {
      res.json({ results: [] });
      return;
    }

    let drivePages: IndexedPage[] = [];
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token) {
        const userKey = await resolveDriveUserKey(token);
        drivePages =
          driveFolderStore.get(buildDriveStoreKey(userKey, resourceIds))
            ?.pages ?? [];
      }
    }

    const candidatePages: IndexedPage[] = [];
    if (scope === 'all' || scope === 'drive') {
      candidatePages.push(...drivePages);
    }
    if (scope === 'all' || scope === 'bundled') {
      candidatePages.push(...bundledPages);
    }

    const hits = retrieveRelevantPages(q, candidatePages, 25);
    res.json({
      results: hits.map((h) => ({
        docId: h.page.docId,
        docName: h.page.docName,
        shortName: h.page.shortName,
        sourceType: h.page.sourceType,
        pageNumber: h.page.pageNumber,
        score: Math.round(h.score * 10) / 10,
        matchedTerms: h.matchedTerms,
        snippet: buildSnippet(h.page.text, h.matchedTerms),
        webViewLink: h.page.webViewLink,
        localPdfUrl: h.page.localPdfUrl,
      })),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Search failed.',
    });
  }
});

app.get('/api/page', async (req: Request, res: Response) => {
  try {
    await ensureBundledIndexed(req);
    const docId = typeof req.query.docId === 'string' ? req.query.docId : '';
    const pageNumber = Number(req.query.page || '1');
    const resourceIds = normalizeDriveResourceIds(
      typeof req.query.folderId === 'string' ? req.query.folderId : undefined,
    );

    let target = bundledPages.find(
      (p) => p.docId === docId && p.pageNumber === pageNumber,
    );

    if (!target) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        if (token) {
          const userKey = await resolveDriveUserKey(token);
          const drivePages =
            driveFolderStore.get(buildDriveStoreKey(userKey, resourceIds))
              ?.pages ?? [];
          target = drivePages.find(
            (p) => p.docId === docId && p.pageNumber === pageNumber,
          );
        }
      }
    }

    if (!target) {
      res.status(404).json({ error: 'Requested manual page not found.' });
      return;
    }

    res.json({
      docId: target.docId,
      docName: target.docName,
      shortName: target.shortName,
      sourceType: target.sourceType,
      pageNumber: target.pageNumber,
      text: target.text,
      webViewLink: target.webViewLink,
      localPdfUrl: target.localPdfUrl,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load page.',
    });
  }
});

app.post('/api/ask', async (req: Request, res: Response) => {
  try {
    await ensureBundledIndexed(req);

    const question =
      typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const rawFolderInputs = Array.isArray(req.body?.folderInputs)
      ? (req.body.folderInputs as string[])
      : typeof req.body?.folderId === 'string'
        ? req.body.folderId
        : undefined;
    const resourceIds = normalizeDriveResourceIds(rawFolderInputs);
    const sourceScope =
      typeof req.body?.sourceScope === 'string' ? req.body.sourceScope : 'all';
    const selectedDocIds = Array.isArray(req.body?.selectedDocIds)
      ? (req.body.selectedDocIds as string[])
      : [];

    if (!question) {
      res.status(400).json({ error: 'Please enter a question.' });
      return;
    }

    let driveState: DriveFolderState | null = null;
    let driveSyncWarning: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token) {
        const userKey = await resolveDriveUserKey(token);
        const storeKey = buildDriveStoreKey(userKey, resourceIds);
        driveState = driveFolderStore.get(storeKey) ?? null;
        if (!driveState && sourceScope !== 'bundled') {
          let syncPromise = inFlightDriveSyncs.get(storeKey);
          if (!syncPromise) {
            syncPromise = syncDriveFolder(resourceIds, token).finally(() => {
              inFlightDriveSyncs.delete(storeKey);
            });
            inFlightDriveSyncs.set(storeKey, syncPromise);
          }
          try {
            const raceResult = await Promise.race([
              syncPromise.then((synced) => ({ ok: true as const, state: synced.state })),
              new Promise<{ ok: false }>((resolve) =>
                setTimeout(() => resolve({ ok: false }), 2500),
              ),
            ]);
            if (raceResult.ok) {
              driveState = raceResult.state;
            } else {
              driveSyncWarning =
                'Google Drive files are still syncing in the background; answered immediately from CBS Manual 2026.';
            }
          } catch (syncErr) {
            driveSyncWarning =
              syncErr instanceof Error
                ? syncErr.message
                : 'Unable to sync Google Drive folder.';
          }
        }
      }
    }

    let candidatePages: IndexedPage[] = [];
    if (sourceScope === 'all' || sourceScope === 'drive') {
      if (driveState) {
        candidatePages.push(...driveState.pages);
      }
    }
    if (sourceScope === 'all' || sourceScope === 'bundled') {
      candidatePages.push(...bundledPages);
    }

    if (selectedDocIds.length > 0) {
      const allowed = new Set(selectedDocIds);
      candidatePages = candidatePages.filter((p) => allowed.has(p.docId));
    }

    if (candidatePages.length === 0) {
      res.status(400).json({
        error:
          driveSyncWarning ||
          (sourceScope === 'drive'
            ? 'No Google Drive files are synced yet. Sign in with Google and sync the Drive folder first.'
            : 'No manual documents are currently available in the selected scope.'),
      });
      return;
    }

    const lastUserTurn = [...history]
      .reverse()
      .find((m: { role?: string; content?: string }) => m?.role === 'user');
    const retrievalQuery =
      question.split(/\s+/).length <= 5 && lastUserTurn?.content
        ? `${lastUserTurn.content} ${question}`
        : question;

    const topScored = retrieveRelevantPages(retrievalQuery, candidatePages, 7);

    const focusWindow = (
      text: string,
      matchedTerms: string[],
      maxLen: number,
    ): string => {
      if (text.length <= maxLen) return text;
      const lower = text.toLowerCase();
      let bestPos = 0;
      for (const t of matchedTerms) {
        const idx = lower.indexOf(t);
        if (idx !== -1) {
          bestPos = idx;
          break;
        }
      }
      const start = Math.max(0, bestPos - Math.floor(maxLen * 0.3));
      const end = Math.min(text.length, start + maxLen);
      return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
    };

    let contextChars = 0;
    const maxContextChars = 7500;
    const includedHits: Array<ScoredPage & { excerptText: string }> = [];

    for (let i = 0; i < topScored.length; i++) {
      const hit = topScored[i];
      const maxExcerpt = i < 2 ? 1550 : 850;
      const excerptText = focusWindow(hit.page.text, hit.matchedTerms, maxExcerpt);
      const blockLen = excerptText.length + 90;
      if (
        contextChars + blockLen > maxContextChars &&
        includedHits.length >= 4
      ) {
        break;
      }
      includedHits.push({ ...hit, excerptText });
      contextChars += blockLen;
    }

    const contextText = includedHits
      .map(
        (h, i) =>
          `[${i + 1}] ${h.page.shortName}, p.${h.page.pageNumber}:\n${h.excerptText}`,
      )
      .join('\n\n');

    res.socket?.setNoDelay?.(true);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const sendEvent = (event: string, payload: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    const citations = includedHits.slice(0, 6).map((h) => ({
      docId: h.page.docId,
      docName: h.page.docName,
      shortName: h.page.shortName,
      sourceType: h.page.sourceType,
      pageNumber: h.page.pageNumber,
      snippet: buildSnippet(h.page.text, h.matchedTerms),
      webViewLink: h.page.webViewLink,
      localPdfUrl: h.page.localPdfUrl,
    }));

    const normalizedQ = question
      .toLowerCase()
      .replace(/[?!.]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const cacheKey = `${normalizedQ}|${sourceScope}|${selectedDocIds.slice().sort().join(',')}|${driveState?.syncedAt ?? 'none'}`;
    if (history.length === 0) {
      const cachedAnswer = answerCache.get(cacheKey);
      if (cachedAnswer) {
        sendEvent('sources', {
          citations: cachedAnswer.citations,
          driveConnected: Boolean(driveState),
          driveDocsCount:
            driveState?.docs.filter((d) => d.status === 'indexed').length ?? 0,
          bundledDocsCount: bundledDocs.length,
          driveSyncWarning,
        });
        sendEvent('chunk', { text: cachedAnswer.answer });
        sendEvent('done', { ok: true });
        res.end();
        return;
      }
    }

    sendEvent('sources', {
      citations,
      driveConnected: Boolean(driveState),
      driveDocsCount:
        driveState?.docs.filter((d) => d.status === 'indexed').length ?? 0,
      bundledDocsCount: bundledDocs.length,
      driveSyncWarning,
    });

    const apiKey = (
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      ''
    ).trim();

    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      const directAnswer = buildDirectManualAnswer(question, includedHits);
      sendEvent('chunk', { text: directAnswer });
      sendEvent('done', { ok: true });
      res.end();
      return;
    }

    try {
      const ai = getAiClient(apiKey);

      const systemInstruction = `You are the India Post POSB CBS Manual 2026 quick-reference assistant.
Give fast, direct, concise answers strictly from the provided excerpts:
- Start immediately with the direct answer (rule, Finacle menu code in backticks like \`CASBAO\`, form like \`SB-7\`, or limit).
- Keep responses brief and scannable (bullet points, ~80-180 words) unless the user asks for full step-by-step details.
- Cite inline as **[Document Short Name, Page X]**.
- Separate Maker/Checker steps or add a compact table only when needed for the question.
- Never invent menu codes or rules not present in the excerpts.`;

      const recentHistory = history
        .slice(-2)
        .filter(
          (m: { role?: string; content?: string }) =>
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string' &&
            m.content.trim().length > 0,
        )
        .map((m: { role: string; content: string }) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content.slice(0, 600) }],
        }));

      const userPrompt = `Excerpts:\n${contextText}\n\nQuestion: ${question}`;

      const contents = [
        ...recentHistory,
        { role: 'user', parts: [{ text: userPrompt }] },
      ];

      const customModel = process.env.GEMINI_MODEL?.trim();
      const allAttempts: Array<{
        key: string;
        model: string;
        thinkingLevel?: ThinkingLevel;
      }> = [
        ...(customModel
          ? [{ key: `custom:${customModel}`, model: customModel }]
          : []),
        {
          key: 'flash-lite-minimal',
          model: 'gemini-3.1-flash-lite',
          thinkingLevel: ThinkingLevel.MINIMAL,
        },
        {
          key: 'hydrogen-low',
          model: 'gemini-4-hydrogen',
          thinkingLevel: ThinkingLevel.LOW,
        },
        {
          key: 'hydrogen-default',
          model: 'gemini-4-hydrogen',
        },
      ];

      // Skip models that previously returned permanent 400/404 errors so every question starts fast
      const activeAttempts = allAttempts.filter((a) => !failedModelKeys.has(a.key));
      const attemptsToRun = activeAttempts.length > 0 ? activeAttempts : allAttempts;

      let fullAnswer = '';
      let lastError: unknown = null;

      for (const attempt of attemptsToRun) {
        try {
          const stream = await ai.models.generateContentStream({
            model: attempt.model,
            contents,
            config: {
              systemInstruction,
              ...(attempt.thinkingLevel
                ? { thinkingConfig: { thinkingLevel: attempt.thinkingLevel } }
                : {}),
            },
          });

          for await (const chunk of stream) {
            if (chunk.text) {
              fullAnswer += chunk.text;
              sendEvent('chunk', { text: chunk.text });
            }
          }
          lastError = null;
          break;
        } catch (attemptErr) {
          lastError = attemptErr;
          const errMsg =
            attemptErr instanceof Error ? attemptErr.message : String(attemptErr);
          if (
            /\b(400|404)\b|NOT_FOUND|INVALID_ARGUMENT/i.test(errMsg) &&
            fullAnswer.length === 0
          ) {
            failedModelKeys.add(attempt.key);
          }
          if (fullAnswer.length > 0) {
            break;
          }
        }
      }

      if (!fullAnswer.trim()) {
        if (lastError) {
          console.warn(
            '[CBS Ask] Falling back to direct manual answer after model error:',
            lastError instanceof Error ? lastError.message : String(lastError),
          );
        }
        const directAnswer = buildDirectManualAnswer(question, includedHits);
        fullAnswer = directAnswer;
        sendEvent('chunk', { text: directAnswer });
      }

      if (history.length === 0 && fullAnswer.trim()) {
        if (answerCache.size >= 200) {
          const oldestKey = answerCache.keys().next().value;
          if (oldestKey) answerCache.delete(oldestKey);
        }
        answerCache.set(cacheKey, { answer: fullAnswer, citations });
      }

      sendEvent('done', { ok: true });
      res.end();
    } catch (err) {
      console.error('[CBS Ask] Unexpected error, using manual fallback:', err);
      const directAnswer = buildDirectManualAnswer(question, includedHits);
      sendEvent('chunk', { text: directAnswer });
      sendEvent('done', { ok: true });
      res.end();
    }
  } catch (outerErr) {
    console.error('[CBS Ask] Outer route error:', outerErr);
    if (!res.headersSent) {
      res.status(500).json({
        error:
          outerErr instanceof Error
            ? outerErr.message
            : 'Unable to process question.',
      });
    } else {
      res.end();
    }
  }
});

export default app;
