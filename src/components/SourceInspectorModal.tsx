import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  X,
} from 'lucide-react';
import type { InspectedPage } from '../types';

interface SourceInspectorModalProps {
  page: InspectedPage | null;
  onClose: () => void;
  onNavigatePage: (docId: string, pageNumber: number) => void;
  isLoadingPage: boolean;
}

export const SourceInspectorModal: React.FC<SourceInspectorModalProps> = ({
  page,
  onClose,
  onNavigatePage,
  isLoadingPage,
}) => {
  const [viewMode, setViewMode] = useState<'text' | 'pdf'>('text');

  if (!page) return null;

  const canShowPdf = Boolean(page.localPdfUrl);
  const effectiveViewMode = canShowPdf ? viewMode : 'text';
  const isSbOrders = page.docId === 'bundled-sb-orders';
  const pdfSrc = page.localPdfUrl
    ? `${page.localPdfUrl}#page=${page.pageNumber}`
    : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white h-full border-l border-[#E2DFD7] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-3.5 sm:px-4 py-3 border-b-[3px] border-[#FFCD00] bg-[#B91C1C] text-white flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-start justify-between gap-2 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#FFCD00] shrink-0" />
                <h2 className="text-sm font-semibold text-white truncate">
                  {page.docName}
                </h2>
              </div>
              <div className="text-xs text-red-100 mt-0.5 tabular-nums flex flex-wrap items-center gap-1.5">
                <span>
                  {page.sourceType === 'drive'
                    ? 'Google Drive Source'
                    : isSbOrders
                      ? 'Saved SB Order Notes (2016–2025)'
                      : 'Saved CBS Manual 2026'}
                </span>
                <span>·</span>
                <span className="font-medium text-white">
                  {isSbOrders
                    ? `Year ${2015 + page.pageNumber} (Page ${page.pageNumber})`
                    : `Page ${page.pageNumber}`}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="sm:hidden p-2 rounded text-white hover:bg-[#991B1B] shrink-0"
              aria-label="Close source viewer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canShowPdf && (
              <div className="flex items-center bg-[#991B1B] p-0.5 rounded text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode('text')}
                  className={`px-2.5 py-1.5 sm:py-1 rounded font-medium whitespace-nowrap ${
                    viewMode === 'text'
                      ? 'bg-white text-[#991B1B]'
                      : 'text-red-100 hover:text-white'
                  }`}
                >
                  Extracted Text
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('pdf')}
                  className={`px-2.5 py-1.5 sm:py-1 rounded font-medium whitespace-nowrap ${
                    viewMode === 'pdf'
                      ? 'bg-white text-[#991B1B]'
                      : 'text-red-100 hover:text-white'
                  }`}
                >
                  PDF View
                </button>
              </div>
            )}

            {page.webViewLink && (
              <a
                href={page.webViewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-[#8B0000] bg-[#FFCD00] hover:bg-[#FACC15] rounded px-2.5 py-1.5 whitespace-nowrap"
              >
                <span>Open in Drive</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}

            <button
              type="button"
              onClick={onClose}
              className="hidden sm:inline-flex p-1.5 rounded text-red-100 hover:text-white hover:bg-[#991B1B]"
              aria-label="Close source viewer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Strip */}
        <div className="px-3.5 sm:px-4 py-2 border-b border-[#E8DFD5] bg-white flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page.pageNumber <= 1 || isLoadingPage}
              onClick={() => onNavigatePage(page.docId, page.pageNumber - 1)}
              className="h-9 sm:h-8 inline-flex items-center gap-1 px-2.5 rounded border border-[#DED4C8] text-slate-700 hover:bg-[#FAF7F2] disabled:opacity-40 whitespace-nowrap"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Prev</span>
            </button>
            <button
              type="button"
              disabled={isLoadingPage}
              onClick={() => onNavigatePage(page.docId, page.pageNumber + 1)}
              className="h-9 sm:h-8 inline-flex items-center gap-1 px-2.5 rounded border border-[#DED4C8] text-slate-700 hover:bg-[#FAF7F2] disabled:opacity-40 whitespace-nowrap"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {page.localPdfUrl && (
            <a
              href={pdfSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-[#C8102E] hover:text-[#991B1B] inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span>Open PDF</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden bg-[#FAF9F6]">
          {effectiveViewMode === 'pdf' && pdfSrc ? (
            <iframe
              key={pdfSrc}
              src={pdfSrc}
              title={`${page.shortName} Page ${page.pageNumber}`}
              className="w-full h-full border-0"
            />
          ) : (
            <div className="h-full overflow-y-auto p-5">
              {isLoadingPage ? (
                <div className="space-y-2.5 animate-pulse">
                  <div className="h-4 bg-stone-200 rounded w-3/4" />
                  <div className="h-4 bg-stone-200 rounded w-full" />
                  <div className="h-4 bg-stone-200 rounded w-5/6" />
                  <div className="h-4 bg-stone-200 rounded w-2/3" />
                </div>
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed text-slate-800 bg-white border border-[#E5E2DA] rounded-md p-4">
                  {page.text || '(No selectable text found on this page)'}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
