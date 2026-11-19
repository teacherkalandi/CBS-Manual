import type {
  Citation,
  IndexedDocumentMeta,
  InspectedPage,
  SearchHit,
} from '../types';

interface RawCachedIndex {
  docs: IndexedDocumentMeta[];
  pages: Array<{
    docId: string;
    docName: string;
    shortName: string;
    sourceType: 'bundled' | 'drive';
    pageNumber: number;
    text: string;
    localPdfUrl?: string;
  }>;
}

interface HydratedPage {
  docId: string;
  docName: string;
  shortName: string;
  sourceType: 'bundled' | 'drive';
  pageNumber: number;
  text: string;
  lowerText: string;
  localPdfUrl?: string;
}

interface ScoredClientPage {
  page: HydratedPage;
  score: number;
  matchedTerms: string[];
}

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

let cachedDocs: IndexedDocumentMeta[] | null = null;
let cachedPages: HydratedPage[] | null = null;
let loadingPromise: Promise<{
  docs: IndexedDocumentMeta[];
  pages: HydratedPage[];
}> | null = null;

export async function loadStaticManualIndex(): Promise<{
  docs: IndexedDocumentMeta[];
  pages: HydratedPage[];
}> {
  if (cachedDocs && cachedPages) {
    return { docs: cachedDocs, pages: cachedPages };
  }
  if (!loadingPromise) {
    loadingPromise = (async () => {
      const res = await fetch('/data/cbs_manual_2026_index.json');
      if (!res.ok) {
        throw new Error('Could not load static CBS Manual index.');
      }
      const data = (await res.json()) as RawCachedIndex;
      cachedDocs = (data.docs || []).map((d) => ({
        ...d,
        localPdfUrl:
          d.localPdfUrl ||
          (d.docId === 'bundled-part-1'
            ? '/assets/aistudio/POSB_CBS_Manual_2026_Part_1__1__14291118.pdf'
            : '/assets/aistudio/POSB_CBS_Manual_2026_Part_2_bc45b28c.pdf'),
      }));
      cachedPages = (data.pages || []).map((p) => ({
        ...p,
        lowerText: p.text.toLowerCase(),
        localPdfUrl:
          p.localPdfUrl ||
          (p.docId === 'bundled-part-1'
            ? '/assets/aistudio/POSB_CBS_Manual_2026_Part_1__1__14291118.pdf'
            : '/assets/aistudio/POSB_CBS_Manual_2026_Part_2_bc45b28c.pdf'),
      }));
      return { docs: cachedDocs, pages: cachedPages };
    })().catch((err) => {
      loadingPromise = null;
      throw err;
    });
  }
  return loadingPromise;
}

function tokenizeQuery(query: string) {
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

function scorePages(
  query: string,
  candidatePages: HydratedPage[],
  maxPages = 14,
): ScoredClientPage[] {
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
  const scored: ScoredClientPage[] = [];

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
        while (idx !== -1 && count < 6) {
          count++;
          idx = text.indexOf(term, idx + term.length);
        }
        score += 3 + Math.min(count, 5) * 1.2;
        if (term.length >= 6) score += 1.5;
      }
    }

    for (const phrase of phrases) {
      if (text.includes(phrase)) score += 7;
    }

    for (const code of codeTokens) {
      if (text.includes(code)) score += 12;
    }

    for (const ref of refTokens) {
      if (text.includes(ref)) score += 14;
    }

    if (matchedTerms.length >= 2) {
      score += matchedTerms.length * matchedTerms.length * 1.1;
      if (wantsMenuCode && menuCodeRegex.test(page.text)) {
        score += 4.5;
      }
    }

    if (page.pageNumber <= 12 && matchedTerms.length >= 1) {
      score += 1.5;
    }

    if (score > 0) {
      scored.push({ page, score, matchedTerms });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxPages);
}

export async function searchManualFallback(
  query: string,
  selectedDocIds: string[] = [],
): Promise<SearchHit[]> {
  const { pages } = await loadStaticManualIndex();
  const pool =
    selectedDocIds.length > 0
      ? pages.filter((p) => selectedDocIds.includes(p.docId))
      : pages;

  const hits = scorePages(query, pool, 25);
  return hits.map((h) => ({
    docId: h.page.docId,
    docName: h.page.docName,
    shortName: h.page.shortName,
    sourceType: h.page.sourceType,
    pageNumber: h.page.pageNumber,
    score: Math.round(h.score * 10) / 10,
    matchedTerms: h.matchedTerms,
    snippet: buildSnippet(h.page.text, h.matchedTerms),
    localPdfUrl: h.page.localPdfUrl,
  }));
}

export async function getPageFallback(
  docId: string,
  pageNumber: number,
): Promise<InspectedPage> {
  const { pages } = await loadStaticManualIndex();
  const target = pages.find(
    (p) => p.docId === docId && p.pageNumber === pageNumber,
  );
  if (!target) {
    throw new Error('Requested manual page not found.');
  }
  return {
    docId: target.docId,
    docName: target.docName,
    shortName: target.shortName,
    sourceType: target.sourceType,
    pageNumber: target.pageNumber,
    text: target.text,
    localPdfUrl: target.localPdfUrl,
  };
}

export function formatDirectManualAnswer(
  question: string,
  scoredHits: Array<{
    page: {
      docId: string;
      docName: string;
      shortName: string;
      pageNumber: number;
      text: string;
    };
    matchedTerms: string[];
  }>,
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

export async function askManualFallback(
  question: string,
  selectedDocIds: string[] = [],
): Promise<{
  answer: string;
  citations: Citation[];
  bundledDocsCount: number;
}> {
  const { docs, pages } = await loadStaticManualIndex();
  const pool =
    selectedDocIds.length > 0
      ? pages.filter((p) => selectedDocIds.includes(p.docId))
      : pages;

  const topScored = scorePages(question, pool, 8);
  const citations: Citation[] = topScored.map((h) => ({
    docId: h.page.docId,
    docName: h.page.docName,
    shortName: h.page.shortName,
    sourceType: h.page.sourceType,
    pageNumber: h.page.pageNumber,
    snippet: buildSnippet(h.page.text, h.matchedTerms),
    localPdfUrl: h.page.localPdfUrl,
  }));

  const answer = formatDirectManualAnswer(question, topScored);
  return {
    answer,
    citations,
    bundledDocsCount: docs.length,
  };
}

export async function syncDriveFolderClientFallback(
  folderId: string,
  accessToken: string,
): Promise<{
  folderId: string;
  folderName: string;
  folderUrl: string;
  syncedAt: string;
  docs: IndexedDocumentMeta[];
}> {
  const { pages: bundledPages } = await loadStaticManualIndex();
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink)',
    pageSize: '100',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    orderBy: 'folder,name',
  });

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    throw new Error(`Google Drive API error (${res.status})`);
  }
  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      modifiedTime?: string;
      webViewLink?: string;
    }>;
  };

  const docs: IndexedDocumentMeta[] = [];
  for (const file of data.files ?? []) {
    const sizeBytes = file.size ? Number(file.size) : undefined;
    const lowerName = file.name.toLowerCase();
    const isPart1 =
      sizeBytes === 6028085 ||
      (lowerName.includes('cbs') && /part[\s_-]*1\b|part[\s_-]*i\b/.test(lowerName));
    const isPart2 =
      sizeBytes === 14312184 ||
      (lowerName.includes('cbs') && /part[\s_-]*2\b|part[\s_-]*ii\b/.test(lowerName));
    const matchedBundledId = isPart1
      ? 'bundled-part-1'
      : isPart2
        ? 'bundled-part-2'
        : null;
    const matchedPages = matchedBundledId
      ? bundledPages.filter((p) => p.docId === matchedBundledId)
      : [];

    docs.push({
      docId: matchedBundledId || `drive-${file.id}`,
      docName: file.name,
      shortName: file.name,
      sourceType: 'drive',
      mimeType: file.mimeType,
      pageCount:
        matchedPages.length ||
        (file.mimeType === 'application/pdf' ? 1 : 1),
      charCount: matchedPages.reduce((sum, p) => sum + p.text.length, 0),
      status: 'indexed',
      modifiedTime: file.modifiedTime,
      sizeBytes,
      webViewLink: file.webViewLink,
      localPdfUrl: matchedPages[0]?.localPdfUrl,
    });
  }

  return {
    folderId,
    folderName: 'CBS Manual Google Drive Folder',
    folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
    syncedAt: new Date().toISOString(),
    docs,
  };
}

