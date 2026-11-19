import React from 'react';
import {
  BookOpen,
  Check,
  ExternalLink,
  FileText,
  FolderSync,
  LogOut,
  RefreshCw,
  X,
} from 'lucide-react';
import type { DriveFolderInfo, IndexedDocumentMeta } from '../types';
import { GoogleSignInButton } from './GoogleSignInButton';

const MANUAL_PDF_URLS: Record<string, string> = {
  'bundled-part-1':
    '/assets/aistudio/POSB_CBS_Manual_2026_Part_1__1__14291118.pdf',
  'bundled-part-2':
    '/assets/aistudio/POSB_CBS_Manual_2026_Part_2_bc45b28c.pdf',
};

interface SidebarSourcesProps {
  bundledDocs: IndexedDocumentMeta[];
  driveFolder: DriveFolderInfo | null;
  selectedDocIds: string[];
  onToggleDocSelection: (docId: string) => void;
  onSelectSingleDoc: (docId: string) => void;
  onClearDocSelection: () => void;
  userEmail: string | null;
  hasDriveToken: boolean;
  isSigningIn: boolean;
  isSyncingDrive: boolean;
  driveError: string | null;
  onGoogleSignIn: () => void;
  onSignOut: () => void;
  onSyncDrive: () => void;
  onCloseMobile?: () => void;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SidebarSources: React.FC<SidebarSourcesProps> = ({
  bundledDocs,
  driveFolder,
  selectedDocIds,
  onToggleDocSelection,
  onSelectSingleDoc,
  onClearDocSelection,
  userEmail,
  hasDriveToken,
  isSigningIn,
  isSyncingDrive,
  driveError,
  onGoogleSignIn,
  onSignOut,
  onSyncDrive,
  onCloseMobile,
}) => {
  return (
    <aside className="w-full h-full flex flex-col bg-[#F6F1EA] border-r border-[#E6DDD1] select-none">
      {onCloseMobile && (
        <div className="px-3.5 py-3 bg-[#B91C1C] border-b-[3px] border-[#FFCD00] text-white flex items-center justify-between">
          <span className="text-sm font-semibold">CBS Manual Sources</span>
          <button
            type="button"
            onClick={onCloseMobile}
            className="p-1.5 rounded text-white hover:bg-[#991B1B]"
            aria-label="Close sources drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Manual Scope Header */}
      <div className="p-3.5 border-b border-[#E6DDD1]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            Manual Filter
          </span>
          {selectedDocIds.length > 0 && (
            <button
              type="button"
              onClick={onClearDocSelection}
              className="text-[11px] font-medium text-red-700 hover:text-red-800 whitespace-nowrap"
            >
              Reset ({selectedDocIds.length})
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1 bg-[#E9E1D6] p-0.5 rounded-md">
          <button
            type="button"
            onClick={onClearDocSelection}
            className={`py-2 sm:py-1.5 px-2 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              selectedDocIds.length === 0
                ? 'bg-[#C8102E] text-white shadow-xs'
                : 'text-slate-700 hover:text-slate-950'
            }`}
          >
            All Files
          </button>
          {bundledDocs.map((doc) => {
            const label = doc.docId.includes('part-1') ? 'Part I' : 'Part II';
            const active =
              selectedDocIds.length === 1 && selectedDocIds[0] === doc.docId;
            return (
              <button
                key={doc.docId}
                type="button"
                onClick={() => {
                  if (active) {
                    onClearDocSelection();
                  } else {
                    onSelectSingleDoc(doc.docId);
                  }
                }}
                className={`py-2 sm:py-1.5 px-2 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#C8102E] text-white shadow-xs'
                    : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable Manuals & Google Drive Folder List */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-5">
        {/* 1. POSB CBS Manual 2026 (Part I & Part II) */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <BookOpen className="w-3.5 h-3.5 text-[#C8102E] shrink-0" />
              <span>POSB CBS Manual 2026</span>
            </div>
          </div>

          <div className="space-y-2.5">
            {bundledDocs.length === 0 ? (
              <div className="bg-white border border-[#E2DFD7] rounded-md p-2.5 text-xs text-slate-500">
                Loading Part I &amp; Part II manuals...
              </div>
            ) : (
              bundledDocs.map((doc) => {
                const isSelected = selectedDocIds.includes(doc.docId);
                return (
                  <div
                    key={doc.docId}
                    className={`bg-white border rounded-md p-3 space-y-2 transition-colors ${
                      isSelected
                        ? 'border-red-300 bg-red-50/40'
                        : 'border-[#E2DFD7]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => onToggleDocSelection(doc.docId)}
                        title="Filter answers to this manual"
                        className={`mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                          isSelected
                            ? 'bg-red-700 border-red-700 text-white'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        {isSelected && <Check className="w-2.5 h-2.5" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-slate-900 leading-snug">
                          {doc.shortName}
                        </div>
                        <div className="text-[11px] text-slate-500 leading-snug mt-0.5">
                          {doc.docName.replace(`${doc.shortName} — `, '')}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1.5 border-t border-[#F0EDE6] text-[11px] text-slate-500 tabular-nums">
                      <span>
                        {doc.pageCount} pages · {formatFileSize(doc.sizeBytes)}
                      </span>
                      <a
                        href={
                          doc.localPdfUrl ||
                          MANUAL_PDF_URLS[doc.docId] ||
                          MANUAL_PDF_URLS['bundled-part-1']
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => onCloseMobile?.()}
                        className="inline-flex items-center gap-1 font-medium text-red-700 hover:text-red-800 whitespace-nowrap"
                      >
                        <FileText className="w-3 h-3" />
                        <span>View PDF</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* 2. Google Login & Linked Folder Files */}
        <section className="space-y-2.5 pt-2 border-t border-[#E6DDD1]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <FolderSync className="w-3.5 h-3.5 text-[#C8102E] shrink-0" />
              <span>Folder Files (Google Login)</span>
            </div>
            {hasDriveToken && (
              <button
                type="button"
                onClick={onSyncDrive}
                disabled={isSyncingDrive}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#C8102E] hover:text-[#991B1B] disabled:opacity-50"
                title="Refresh folder files"
              >
                <RefreshCw
                  className={`w-3 h-3 ${isSyncingDrive ? 'animate-spin' : ''}`}
                />
                <span>{isSyncingDrive ? 'Syncing...' : 'Refresh'}</span>
              </button>
            )}
          </div>

          {!hasDriveToken ? (
            <div className="bg-white border border-[#E2DFD7] rounded-md p-3 space-y-2.5">
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Login with Google to view all files available in the CBS Manual folder and search across every file when answering questions.
              </p>
              <GoogleSignInButton
                onClick={onGoogleSignIn}
                disabled={isSigningIn}
                label={isSigningIn ? 'Logging in...' : 'Login to Google'}
              />
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="bg-white border border-[#E2DFD7] rounded-md p-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                    Connected to Google
                  </div>
                  <div className="text-xs font-medium text-slate-800 truncate">
                    {userEmail || 'Google Drive Connected'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-slate-600 hover:text-red-700 hover:bg-red-50 shrink-0"
                  title="Sign out"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Logout</span>
                </button>
              </div>

              {driveError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-2.5 text-[11px] leading-relaxed">
                  {driveError}
                </div>
              )}

              {isSyncingDrive && (!driveFolder || driveFolder.docs.length === 0) ? (
                <div className="bg-white border border-[#E2DFD7] rounded-md p-3 text-xs text-slate-500 flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#C8102E]" />
                  <span>Loading all files from folder...</span>
                </div>
              ) : driveFolder && driveFolder.docs.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 px-0.5">
                    <span>
                      {driveFolder.docs.length} file
                      {driveFolder.docs.length === 1 ? '' : 's'} in folder
                    </span>
                    <span className="text-emerald-700 font-medium">
                      Active in Search
                    </span>
                  </div>
                  {driveFolder.docs.map((doc) => {
                    const isSelected = selectedDocIds.includes(doc.docId);
                    const fileHref = doc.localPdfUrl || doc.webViewLink;
                    return (
                      <div
                        key={doc.docId}
                        className={`bg-white border rounded-md p-2.5 space-y-1.5 transition-colors ${
                          isSelected
                            ? 'border-red-300 bg-red-50/40'
                            : 'border-[#E2DFD7]'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() => onToggleDocSelection(doc.docId)}
                            title="Filter answers to this file"
                            className={`mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                              isSelected
                                ? 'bg-red-700 border-red-700 text-white'
                                : 'border-slate-300 bg-white'
                            }`}
                          >
                            {isSelected && <Check className="w-2.5 h-2.5" />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-slate-900 break-words leading-snug">
                              {doc.shortName}
                            </div>
                            {doc.folderPath && (
                              <div className="text-[10px] text-slate-500 truncate mt-0.5">
                                {doc.folderPath}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-[#F0EDE6] text-[11px] text-slate-500 tabular-nums">
                          <span>
                            {doc.status === 'indexed'
                              ? `${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}${
                                  doc.sizeBytes
                                    ? ` · ${formatFileSize(doc.sizeBytes)}`
                                    : ''
                                }`
                              : doc.note || doc.status}
                          </span>
                          {fileHref && (
                            <a
                              href={fileHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => onCloseMobile?.()}
                              className="inline-flex items-center gap-1 font-medium text-red-700 hover:text-red-800 whitespace-nowrap"
                            >
                              <FileText className="w-3 h-3" />
                              <span>Open File</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-white border border-[#E2DFD7] rounded-md p-2.5 text-xs text-slate-500">
                  No additional files found in folder. Click Refresh to resync.
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};
