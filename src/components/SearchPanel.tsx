import React, { useState } from 'react';
import { BookOpen, FolderSync, Search } from 'lucide-react';
import { searchManualFallback } from '../lib/localManualFallback';
import type { SearchHit, SourceScope } from '../types';

interface SearchPanelProps {
  folderId: string;
  sourceScope: SourceScope;
  accessToken: string | null;
  onInspectHit: (docId: string, pageNumber: number, query: string) => void;
  onAskAboutHit: (prompt: string) => void;
}

const QUICK_CODES = [
  'CASBAO',
  'CRDP',
  'CSBCO',
  'SB-103',
  '194N',
  'MSSC',
  'Deceased Claim',
  'IPOS0000DOP',
];

export const SearchPanel: React.FC<SearchPanelProps> = ({
  folderId,
  sourceScope,
  accessToken,
  onInspectHit,
  onAskAboutHit,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (searchTerm: string) => {
    const trimmed = searchTerm.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setIsSearching(true);
    setError(null);
    setHasSearched(true);

    try {
      const params = new URLSearchParams({
        q: trimmed,
        folderId,
        scope: sourceScope,
      });
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }
      const res = await fetch(`/api/search?${params.toString()}`, { headers });
      const data = (await res.json()) as {
        results?: SearchHit[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Search failed.');
      }
      setResults(data.results ?? []);
    } catch {
      try {
        const fallbackResults = await searchManualFallback(trimmed);
        setResults(fallbackResults);
      } catch (fallbackErr) {
        setError(
          fallbackErr instanceof Error ? fallbackErr.message : 'Search failed.',
        );
        setResults([]);
      }
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-8 py-4 sm:py-6">
      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-5">
        <div className="bg-white border border-[#E8DFD5] rounded-lg p-3.5 sm:p-4 space-y-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Keyword &amp; Finacle Menu Code Lookup
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Search directly across all 748 pages of POSB CBS Manual 2026 (Part I &amp; II).
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(query);
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search menu code, rule, form (e.g., CASBAO, Rule 115, SB-7)..."
                className="w-full h-11 sm:h-10 pl-9 pr-3 text-base sm:text-sm bg-[#FAF7F2] border border-[#DED4C8] rounded-md text-slate-900 focus:outline-none focus:border-[#C8102E]"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching || !query.trim()}
              className="h-11 sm:h-10 px-5 text-sm font-medium bg-[#C8102E] hover:bg-[#991B1B] disabled:opacity-50 text-white rounded-md whitespace-nowrap shrink-0 transition-colors"
            >
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] font-medium text-slate-500 mr-1">
              Quick lookup:
            </span>
            {QUICK_CODES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => runSearch(code)}
                className="text-xs font-mono bg-[#F6F1EA] hover:bg-[#FFF8DB] text-slate-800 border border-[#E2D8CB] hover:border-[#F59E0B] rounded px-2.5 py-1 transition-colors"
              >
                {code}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-md px-4 py-3">
            {error}
          </div>
        )}

        {hasSearched && !isSearching && results.length === 0 && !error && (
          <div className="bg-white border border-[#E8DFD5] rounded-lg p-8 text-center">
            <p className="text-sm font-medium text-slate-800">
              No matching pages found for &ldquo;{query}&rdquo;
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Try a broader term, a Finacle menu code, or a rule/form number.
            </p>
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-2.5">
            <div className="text-xs text-slate-500 tabular-nums">
              Showing {results.length} matching page{results.length === 1 ? '' : 's'}
            </div>
            {results.map((hit) => (
              <div
                key={`${hit.docId}-${hit.pageNumber}`}
                className="bg-white border border-[#E8DFD5] rounded-lg p-3.5 sm:p-4 space-y-2.5 hover:border-[#D5C9BA] transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {hit.sourceType === 'drive' ? (
                      <FolderSync className="w-4 h-4 text-[#C8102E] shrink-0" />
                    ) : (
                      <BookOpen className="w-4 h-4 text-[#C8102E] shrink-0" />
                    )}
                    <span className="text-sm font-semibold text-slate-900 truncate">
                      {hit.shortName}
                    </span>
                    <span className="text-xs font-mono text-[#854D0E] bg-[#FFF8DB] border border-[#FDE047] rounded px-1.5 py-0.5 tabular-nums shrink-0">
                      Page {hit.pageNumber}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        onInspectHit(hit.docId, hit.pageNumber, query)
                      }
                      className="h-9 sm:h-8 text-xs font-medium text-slate-700 hover:text-slate-950 border border-[#DED4C8] bg-[#FAF7F2] rounded px-3 whitespace-nowrap"
                    >
                      Inspect Page
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onAskAboutHit(
                          `Explain the rules and step-by-step Finacle procedure related to "${query}" referenced in ${hit.shortName} (Page ${hit.pageNumber}).`,
                        )
                      }
                      className="h-9 sm:h-8 text-xs font-medium text-white bg-[#C8102E] hover:bg-[#991B1B] rounded px-3 whitespace-nowrap"
                    >
                      Ask AI
                    </button>
                  </div>
                </div>

                <p className="text-[13px] text-slate-700 leading-relaxed">
                  {hit.snippet}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
