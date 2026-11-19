import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  BookOpen,
  Check,
  Copy,
  FileDown,
  FileText,
  Menu,
  MessageSquare,
  Mic,
  Plus,
  RotateCcw,
  Search,
  Square,
  X,
} from 'lucide-react';
import { MarkdownMessage } from './components/MarkdownMessage';
import { SearchPanel } from './components/SearchPanel';
import { SidebarSources } from './components/SidebarSources';
import { SourceInspectorModal } from './components/SourceInspectorModal';
import {
  clearAccessToken,
  googleSignIn,
  initAuth,
  logout,
} from './lib/auth';
import {
  downloadAnswerAsDoc,
  downloadAnswerAsPdf,
  shareAnswerPdfOnWhatsApp,
} from './lib/exportAnswer';
import {
  askManualFallback,
  getPageFallback,
  loadStaticManualIndex,
  syncDriveFolderClientFallback,
} from './lib/localManualFallback';
import { useSpeechDictation } from './lib/useSpeechDictation';
import type {
  ChatMessage,
  Citation,
  DriveFolderInfo,
  IndexedDocumentMeta,
  InspectedPage,
} from './types';

const DEFAULT_FOLDER_ID = '126RoT_pKljrBsqS564Z9uxXE7Tq42ehf';

const STARTER_PROMPTS = [
  {
    title: 'Account Opening & e-KYC',
    prompt:
      'What are the Finacle menus and KYC/CIF rules for opening a new Savings Account (SB) and Joint-B account?',
  },
  {
    title: 'Deceased Claim Settlement',
    prompt:
      'Explain the step-by-step Finacle procedure, documents, and sanction limits for Deceased Claim cases (with and without nomination).',
  },
  {
    title: 'TDS Rules (194A / 194N / 194H)',
    prompt:
      'Summarize TDS deduction thresholds, PAN validation rules, and Finacle procedures under Sections 194A, 194EE, 194H, and 194N.',
  },
  {
    title: 'Mahila Samman (MSSC) & SCSS',
    prompt:
      'What are the deposit limits, tenure, premature closure penalties, and Finacle menus for MSSC 2023 and Senior Citizens Savings Scheme?',
  },
  {
    title: 'SBCO Daily Checks & Objections',
    prompt:
      'List the SBCO daily verification checks, vouchers/registers to examine, and how SBCO objection memos are raised and settled.',
  },
  {
    title: 'RD / TD Premature Closure & Revival',
    prompt:
      'Explain the procedure and Finacle menu codes for RD default fee, revival of discontinued RD account, and premature TD closure.',
  },
];

export default function App() {
  const [bundledDocs, setBundledDocs] = useState<IndexedDocumentMeta[]>([]);
  const [driveFolder, setDriveFolder] = useState<DriveFolderInfo | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSyncingDrive, setIsSyncingDrive] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'assistant' | 'search'>('assistant');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [waStatus, setWaStatus] = useState<{ id: string; text: string } | null>(
    null,
  );

  const [inspectedPage, setInspectedPage] = useState<InspectedPage | null>(null);
  const [isLoadingPage, setIsLoadingPage] = useState(false);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const {
    isSupported: isSpeechSupported,
    isListening,
    error: speechError,
    clearError: clearSpeechError,
    toggleListening,
    stopListening,
  } = useSpeechDictation({
    lang: 'en-IN',
    onTranscriptChange: (text) => setInputValue(text),
  });

  const fetchSources = useCallback(async (token?: string | null) => {
    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(
        `/api/sources?folderId=${encodeURIComponent(DEFAULT_FOLDER_ID)}`,
        { headers },
      );
      if (!res.ok) {
        throw new Error(`Status ${res.status}`);
      }
      const data = (await res.json()) as {
        bundledDocs?: IndexedDocumentMeta[];
        driveFolder?: DriveFolderInfo | null;
      };
      if (data.bundledDocs && data.bundledDocs.length > 0) {
        setBundledDocs(data.bundledDocs);
      }
      if (data.driveFolder) {
        setDriveFolder(data.driveFolder);
      }
      if (data.bundledDocs && data.bundledDocs.length > 0) {
        return;
      }
    } catch {
      // Fallback to static manual index bundled in dist/data/
    }
    try {
      const { docs } = await loadStaticManualIndex();
      if (docs.length > 0) {
        setBundledDocs(docs);
      }
    } catch (err) {
      console.error('Failed to load sources:', err);
    }
  }, []);

  const syncDriveFiles = useCallback(async (token: string) => {
    setIsSyncingDrive(true);
    setDriveError(null);
    try {
      const res = await fetch('/api/drive/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          folderInput: DEFAULT_FOLDER_ID,
          folderInputs: [DEFAULT_FOLDER_ID],
        }),
      });
      const data = (await res.json()) as DriveFolderInfo & { error?: string };
      if (!res.ok) {
        if (res.status === 401) {
          clearAccessToken();
          setAccessToken(null);
        }
        throw new Error(data.error || 'Could not sync Google Drive folder.');
      }
      setDriveFolder({
        folderId: data.folderId,
        folderName: data.folderName,
        folderUrl: data.folderUrl,
        syncedAt: data.syncedAt,
        docs: data.docs || [],
      });
    } catch (err) {
      try {
        const clientSynced = await syncDriveFolderClientFallback(
          DEFAULT_FOLDER_ID,
          token,
        );
        setDriveFolder(clientSynced);
        setDriveError(null);
      } catch {
        setDriveError(
          err instanceof Error
            ? err.message
            : 'Unable to load files from Google Drive folder.',
        );
      }
    } finally {
      setIsSyncingDrive(false);
    }
  }, []);

  useEffect(() => {
    fetchSources(accessToken);
  }, [fetchSources, accessToken]);

  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setUserEmail(user.email);
        setAccessToken(token);
        syncDriveFiles(token);
      },
      (user) => {
        setUserEmail(user?.email ?? null);
        setAccessToken(null);
      },
    );
    return () => unsubscribe();
  }, [syncDriveFiles]);

  // Poll briefly if bundled manuals are still indexing on very first boot
  useEffect(() => {
    if (bundledDocs.length >= 2) return;
    const timer = setTimeout(() => {
      fetchSources(accessToken);
    }, 2000);
    return () => clearTimeout(timer);
  }, [bundledDocs.length, fetchSources, accessToken]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setDriveError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUserEmail(result.user.email);
        setAccessToken(result.accessToken);
        await syncDriveFiles(result.accessToken);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Google login was cancelled or failed.';
      if (!msg.toLowerCase().includes('popup-closed-by-user')) {
        setDriveError(msg);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setUserEmail(null);
    setAccessToken(null);
    setDriveFolder(null);
    setDriveError(null);
  };

  const handleToggleDocSelection = (docId: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId],
    );
  };

  const openPageInspector = async (
    docId: string,
    pageNumber: number,
    highlightQuery?: string,
  ) => {
    setIsLoadingPage(true);
    try {
      const params = new URLSearchParams({
        docId,
        page: String(pageNumber),
        folderId: DEFAULT_FOLDER_ID,
      });
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const res = await fetch(`/api/page?${params.toString()}`, { headers });
      const data = (await res.json()) as InspectedPage & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Could not load manual page.');
      }
      setInspectedPage({ ...data, highlightQuery });
    } catch {
      try {
        const fallbackPage = await getPageFallback(docId, pageNumber);
        setInspectedPage({ ...fallbackPage, highlightQuery });
      } catch (err) {
        console.error(err);
      }
    } finally {
      setIsLoadingPage(false);
    }
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Clipboard unsupported
    }
  };

  const handleAsk = async (overridePrompt?: string) => {
    stopListening();
    const question = (overridePrompt ?? inputValue).trim();
    if (!question || isAsking) return;

    setActiveTab('assistant');
    setInputValue('');
    setIsAsking(true);

    const userMsgId = `u-${Date.now()}`;
    const assistantMsgId = `a-${Date.now() + 1}`;

    const historyPayload = messages
      .filter((m) => !m.error && m.content.trim().length > 0)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: question },
      {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        isStreaming: true,
      },
    ]);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const res = await fetch('/api/ask', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question,
          history: historyPayload,
          folderId: DEFAULT_FOLDER_ID,
          folderInputs: [DEFAULT_FOLDER_ID],
          sourceScope: accessToken ? 'all' : 'bundled',
          selectedDocIds,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errData.error || `Request failed with status ${res.status}`,
        );
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('Streaming response body is unavailable.');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = 'message';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trimEnd();
          if (!line) {
            currentEvent = 'message';
            continue;
          }
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
            continue;
          }
          if (line.startsWith('data:')) {
            const jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;
            try {
              const payload = JSON.parse(jsonStr) as {
                text?: string;
                message?: string;
                citations?: Citation[];
                driveConnected?: boolean;
                driveDocsCount?: number;
                bundledDocsCount?: number;
                driveSyncWarning?: string | null;
              };

              if (currentEvent === 'sources') {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          citations: payload.citations,
                          driveConnected: payload.driveConnected,
                          driveDocsCount: payload.driveDocsCount,
                          bundledDocsCount: payload.bundledDocsCount,
                          driveSyncWarning: payload.driveSyncWarning,
                        }
                      : m,
                  ),
                );
              } else if (currentEvent === 'chunk' && payload.text) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: m.content + payload.text }
                      : m,
                  ),
                );
              } else if (currentEvent === 'error') {
                throw new Error(payload.message || 'Answer generation failed.');
              }
            } catch (parseErr) {
              if (
                parseErr instanceof Error &&
                currentEvent === 'error'
              ) {
                throw parseErr;
              }
            }
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, isStreaming: false } : m,
        ),
      );
    } catch (err) {
      // Fallback to direct client-side manual search & reference answer if /api/ask fails
      try {
        const fallback = await askManualFallback(question, selectedDocIds);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  isStreaming: false,
                  error: undefined,
                  content: fallback.answer,
                  citations: fallback.citations,
                  bundledDocsCount: fallback.bundledDocsCount,
                }
              : m,
          ),
        );
      } catch {
        const errorMsg =
          err instanceof Error ? err.message : 'Unable to answer question.';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  isStreaming: false,
                  error: errorMsg,
                }
              : m,
          ),
        );
      }
    } finally {
      setIsAsking(false);
    }
  };

  const totalBundledPages = bundledDocs.reduce((acc, d) => acc + d.pageCount, 0);
  const driveDocsCount = driveFolder?.docs.length ?? 0;

  return (
    <div className="h-dvh w-full overflow-hidden flex bg-[#FAF7F2] text-slate-900">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block w-[290px] shrink-0 h-full">
        <SidebarSources
          bundledDocs={bundledDocs}
          driveFolder={driveFolder}
          selectedDocIds={selectedDocIds}
          onToggleDocSelection={handleToggleDocSelection}
          onSelectSingleDoc={(docId) => setSelectedDocIds([docId])}
          onClearDocSelection={() => setSelectedDocIds([])}
          userEmail={userEmail}
          hasDriveToken={Boolean(accessToken)}
          isSigningIn={isSigningIn}
          isSyncingDrive={isSyncingDrive}
          driveError={driveError}
          onGoogleSignIn={handleGoogleSignIn}
          onSignOut={handleSignOut}
          onSyncDrive={() => accessToken && syncDriveFiles(accessToken)}
        />
      </div>

      {/* Mobile Sidebar Drawer */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden flex bg-slate-950/50 backdrop-blur-[1px]"
          onClick={() => setMobileSidebarOpen(false)}
        >
          <div
            className="w-[min(86vw,320px)] h-full bg-[#F6F1EA] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarSources
              bundledDocs={bundledDocs}
              driveFolder={driveFolder}
              selectedDocIds={selectedDocIds}
              onToggleDocSelection={handleToggleDocSelection}
              onSelectSingleDoc={(docId) => setSelectedDocIds([docId])}
              onClearDocSelection={() => setSelectedDocIds([])}
              userEmail={userEmail}
              hasDriveToken={Boolean(accessToken)}
              isSigningIn={isSigningIn}
              isSyncingDrive={isSyncingDrive}
              driveError={driveError}
              onGoogleSignIn={handleGoogleSignIn}
              onSignOut={handleSignOut}
              onSyncDrive={() => accessToken && syncDriveFiles(accessToken)}
              onCloseMobile={() => setMobileSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* India Post Crimson Top Bar + Dak Golden Yellow Accent */}
        <header className="shrink-0 bg-[#B91C1C] text-white border-b-[3px] border-[#FFCD00] px-3 sm:px-6 h-14 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden h-9 w-9 inline-flex items-center justify-center rounded-md bg-[#991B1B] border border-[#DC2626] text-white hover:bg-[#7F1D1D] shrink-0"
              aria-label="Open manual sources"
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded bg-[#FFCD00] text-[#8B0000] flex items-center justify-center shrink-0">
                <BookOpen className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-[15px] font-semibold text-white truncate">
                  <span className="sm:hidden">CBS Manual AI</span>
                  <span className="hidden sm:inline">CBS Manual AI Assistant</span>
                </h1>
                <p className="text-[11px] text-red-100 truncate tabular-nums hidden sm:block">
                  India Post POSB 2026 · {totalBundledPages || 748} pages
                  {driveDocsCount > 0
                    ? ` + ${driveDocsCount} folder file${driveDocsCount === 1 ? '' : 's'} synced`
                    : ' saved & ready'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <div className="flex items-center bg-[#991B1B] p-0.5 rounded-md border border-[#DC2626]">
              <button
                type="button"
                onClick={() => setActiveTab('assistant')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'assistant'
                    ? 'bg-white text-[#991B1B] shadow-xs'
                    : 'text-red-100 hover:text-white'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Assistant</span>
                <span className="sm:hidden">Ask</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('search')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'search'
                    ? 'bg-white text-[#991B1B] shadow-xs'
                    : 'text-red-100 hover:text-white'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Manual Lookup</span>
                <span className="sm:hidden">Lookup</span>
              </button>
            </div>

            {messages.length > 0 && activeTab === 'assistant' && (
              <button
                type="button"
                onClick={() => setMessages([])}
                disabled={isAsking}
                aria-label="New thread"
                className="h-9 sm:h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md bg-[#FFCD00] hover:bg-[#FACC15] text-xs font-semibold text-[#8B0000] disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">New Thread</span>
              </button>
            )}
          </div>
        </header>

        {/* Active View */}
        {activeTab === 'search' ? (
          <SearchPanel
            folderId={DEFAULT_FOLDER_ID}
            sourceScope={accessToken ? 'all' : 'bundled'}
            accessToken={accessToken}
            onInspectHit={(docId, pageNumber, q) =>
              openPageInspector(docId, pageNumber, q)
            }
            onAskAboutHit={(prompt) => handleAsk(prompt)}
          />
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Scrollable Chat Viewport */}
            <div className="flex-1 overflow-y-auto px-3 sm:px-8 py-4 sm:py-6">
              <div className="max-w-3xl mx-auto">
                {messages.length === 0 ? (
                  <div className="space-y-5 sm:space-y-6 py-2 sm:py-4">
                    {/* Hero Intro */}
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#C8102E]">
                        Department of Posts · India Post CBS Reference
                      </div>
                      <h2 className="text-xl sm:text-[26px] font-semibold text-slate-900 tracking-tight leading-snug">
                        Ask any rule, Finacle menu code, or POSB procedure
                      </h2>
                      <p className="text-sm text-slate-600 leading-relaxed max-w-2xl">
                        All 748 pages of POSB CBS Manual 2026 Part I (Chapters 1–22) and Part II (Appendices I–XXIX) are permanently saved inside this tool. Open the menu to <strong>Login to Google</strong> and search across every file in your linked folder.
                      </p>
                    </div>

                    {/* Quick Starter Prompts */}
                    <div className="space-y-2.5">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Common Counter &amp; SBCO Queries
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {STARTER_PROMPTS.map((item) => (
                          <button
                            key={item.title}
                            type="button"
                            onClick={() => handleAsk(item.prompt)}
                            className="text-left bg-white hover:bg-[#FFFDF7] border border-[#E8DFD5] hover:border-[#C8102E] rounded-lg p-3.5 transition-colors group"
                          >
                            <div className="text-[13px] sm:text-xs font-semibold text-slate-900 group-hover:text-[#C8102E] transition-colors">
                              {item.title}
                            </div>
                            <div className="text-xs text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                              {item.prompt}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 sm:space-y-6 pb-4">
                    {messages.map((msg, msgIndex) => {
                      const relatedQuestion =
                        msg.role === 'assistant'
                          ? ([...messages.slice(0, msgIndex)]
                              .reverse()
                              .find((m) => m.role === 'user')?.content ?? '')
                          : '';
                      return (
                      <div key={msg.id} className="min-w-0">
                        {msg.role === 'user' ? (
                          <div className="flex justify-end">
                            <div className="max-w-[90%] sm:max-w-[85%] bg-[#B91C1C] text-white rounded-lg px-3.5 sm:px-4 py-2.5 text-sm leading-relaxed">
                              {msg.content}
                            </div>
                          </div>
                        ) : (
                          <div className="bg-white border border-[#E8DFD5] rounded-lg p-3.5 sm:p-5 space-y-4 min-w-0">
                            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#F2EAE0]">
                              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                                <BookOpen className="w-3.5 h-3.5 text-[#C8102E]" />
                                <span>CBS Manual Reference Answer</span>
                              </div>
                              {!msg.isStreaming && msg.content && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      downloadAnswerAsPdf({
                                        question: relatedQuestion,
                                        answer: msg.content,
                                        citations: msg.citations,
                                      })
                                    }
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 bg-red-50/70 hover:bg-red-100 text-[11px] font-medium text-[#991B1B] transition-colors whitespace-nowrap"
                                    title="Download answer as PDF"
                                  >
                                    <FileDown className="w-3.5 h-3.5" />
                                    <span className="hidden sm:inline">Download PDF</span>
                                    <span className="sm:hidden">PDF</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      downloadAnswerAsDoc({
                                        question: relatedQuestion,
                                        answer: msg.content,
                                        citations: msg.citations,
                                      })
                                    }
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#E2D8CB] bg-[#FAF7F2] hover:bg-[#FFF8DB] text-[11px] font-medium text-slate-800 transition-colors whitespace-nowrap"
                                    title="Download answer as Word DOC file"
                                  >
                                    <FileText className="w-3.5 h-3.5 text-[#B45309]" />
                                    <span className="hidden sm:inline">Download DOC</span>
                                    <span className="sm:hidden">DOC</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const result = await shareAnswerPdfOnWhatsApp({
                                        question: relatedQuestion,
                                        answer: msg.content,
                                        citations: msg.citations,
                                      });
                                      if (result === 'shared') {
                                        setWaStatus({ id: msg.id, text: 'Sent' });
                                        setTimeout(() => setWaStatus(null), 2200);
                                      } else if (result === 'downloaded-and-opened') {
                                        setWaStatus({ id: msg.id, text: 'PDF Ready' });
                                        setTimeout(() => setWaStatus(null), 2600);
                                      }
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-[11px] font-medium text-emerald-800 transition-colors whitespace-nowrap"
                                    title="Send PDF directly on WhatsApp"
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      fill="currentColor"
                                      className="w-3.5 h-3.5 text-[#16A34A] shrink-0"
                                      aria-hidden="true"
                                    >
                                      <path d="M12.031 2C6.508 2 2.016 6.492 2.016 12.015c0 1.766.461 3.49 1.337 5.012L2 22l5.107-1.339a9.97 9.97 0 0 0 4.924 1.298h.004c5.522 0 10.015-4.492 10.015-10.015A9.953 9.953 0 0 0 19.12 4.914 9.95 9.95 0 0 0 12.031 2zm5.825 14.156c-.246.693-1.441 1.325-1.99 1.406-.508.075-1.168.107-1.884-.12-.435-.138-.993-.323-1.71-.633-3.008-1.298-4.972-4.33-5.122-4.53-.15-.2-1.224-1.63-1.224-3.109 0-1.479.775-2.206 1.05-2.507.275-.3.6-.375.8-.375.2 0 .4.002.575.01.184.009.431-.07.674.515.25.6.85 2.078.925 2.228.075.15.125.325.025.525-.1.2-.15.325-.3.5-.15.175-.316.391-.45.525-.15.15-.307.313-.132.613.175.3.778 1.284 1.67 2.08 1.148 1.023 2.115 1.34 2.415 1.49.3.15.475.125.65-.075.175-.2.75-.875.95-1.175.2-.3.4-.25.675-.15.275.1 1.748.825 2.048.975.3.15.5.225.575.35.075.125.075.725-.171 1.418z" />
                                    </svg>
                                    <span>
                                      {waStatus?.id === msg.id
                                        ? waStatus.text
                                        : 'WhatsApp'}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(msg.id, msg.content)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-transparent hover:border-[#E8DFD5] hover:bg-[#FAF7F2] text-[11px] font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap"
                                    title="Copy answer text"
                                  >
                                    {copiedId === msg.id ? (
                                      <>
                                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                                        <span>Copied</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3.5 h-3.5" />
                                        <span>Copy</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>

                            {msg.driveSyncWarning && (
                              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                                Google Drive notice: {msg.driveSyncWarning}
                              </div>
                            )}

                            {msg.error ? (
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3.5 py-2.5">
                                <span className="leading-relaxed">{msg.error}</span>
                                <button
                                  type="button"
                                  disabled={isAsking}
                                  onClick={() => {
                                    const idx = messages.findIndex(
                                      (m) => m.id === msg.id,
                                    );
                                    const prevUser = [...messages.slice(0, idx)]
                                      .reverse()
                                      .find((m) => m.role === 'user');
                                    if (prevUser) {
                                      setMessages((prev) =>
                                        prev.filter(
                                          (m) =>
                                            m.id !== msg.id &&
                                            m.id !== prevUser.id,
                                        ),
                                      );
                                      handleAsk(prevUser.content);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-red-300 bg-white hover:bg-red-100 text-xs font-medium text-red-800 shrink-0 self-start sm:self-center whitespace-nowrap"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  <span>Retry</span>
                                </button>
                              </div>
                            ) : msg.content ? (
                              <MarkdownMessage content={msg.content} />
                            ) : (
                              <div className="space-y-2 py-1">
                                <div className="text-xs font-medium text-[#C8102E]">
                                  {msg.citations && msg.citations.length > 0
                                    ? `Matched ${msg.citations.length} manual pages — generating answer...`
                                    : 'Searching all CBS Manual & folder files...'}
                                </div>
                                <div className="h-3.5 bg-stone-200/80 rounded w-3/4 animate-pulse" />
                                <div className="h-3.5 bg-stone-200/80 rounded w-5/6 animate-pulse" />
                                <div className="h-3.5 bg-stone-200/80 rounded w-1/2 animate-pulse" />
                              </div>
                            )}

                            {msg.citations && msg.citations.length > 0 && (
                              <div className="pt-3 border-t border-[#F2EAE0] space-y-2">
                                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                                  Referenced Pages &amp; Sources
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {msg.citations.slice(0, 8).map((cit) => (
                                    <button
                                      key={`${cit.docId}-${cit.pageNumber}`}
                                      type="button"
                                      onClick={() =>
                                        openPageInspector(
                                          cit.docId,
                                          cit.pageNumber,
                                        )
                                      }
                                      className="text-left flex items-start gap-2.5 p-2.5 rounded border border-[#E8DFD5] bg-[#FAF7F2] hover:bg-[#FFF8DB]/60 hover:border-[#F59E0B] transition-colors"
                                    >
                                      <FileText className="w-3.5 h-3.5 text-[#C8102E] shrink-0 mt-0.5" />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="text-xs font-medium text-slate-900 truncate">
                                            {cit.shortName}
                                          </span>
                                          <span className="text-[11px] font-mono text-[#854D0E] bg-[#FFF8DB] border border-[#FDE047] rounded px-1 py-0.5 tabular-nums shrink-0">
                                            p.{cit.pageNumber}
                                          </span>
                                        </div>
                                        <p className="text-[11px] text-slate-600 line-clamp-1 mt-0.5">
                                          {cit.snippet}
                                        </p>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      );
                    })}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Composer */}
            <div className="shrink-0 bg-white border-t border-[#E8DFD5] px-3 sm:px-8 pt-2.5 pb-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAsk();
                }}
                className="max-w-3xl mx-auto"
              >
                {speechError && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                    <span>{speechError}</span>
                    <button
                      type="button"
                      onClick={clearSpeechError}
                      className="p-0.5 text-red-600 hover:text-red-900 shrink-0"
                      aria-label="Dismiss microphone notice"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {isListening && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50/70 px-3 py-1.5 text-xs text-[#991B1B]">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="w-2 h-2 rounded-full bg-[#C8102E] animate-ping" />
                      <span>Listening... speak your question now</span>
                    </div>
                    <button
                      type="button"
                      onClick={stopListening}
                      className="text-[11px] font-semibold text-[#C8102E] hover:underline"
                    >
                      Stop
                    </button>
                  </div>
                )}

                <div
                  className={`flex items-end gap-1.5 sm:gap-2 bg-[#FAF7F2] border rounded-lg p-1.5 sm:p-2 transition-colors ${
                    isListening
                      ? 'border-[#C8102E] ring-2 ring-red-100'
                      : 'border-[#DED4C8] focus-within:border-[#C8102E]'
                  }`}
                >
                  <textarea
                    rows={1}
                    value={inputValue}
                    onChange={(e) => {
                      if (speechError) clearSpeechError();
                      setInputValue(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAsk();
                      }
                    }}
                    placeholder={
                      isListening
                        ? 'Listening... speak your question'
                        : 'Ask about CBS Manual 2026, Finacle menus, or folder files...'
                    }
                    className="flex-1 resize-none bg-transparent text-base sm:text-sm text-slate-900 placeholder:text-slate-400 px-2 py-1.5 focus:outline-none max-h-36"
                  />
                  <button
                    type="button"
                    onClick={() => toggleListening(inputValue)}
                    disabled={isAsking || !isSpeechSupported}
                    aria-label={
                      isListening ? 'Stop voice dictation' : 'Dictate question with microphone'
                    }
                    title={
                      !isSpeechSupported
                        ? 'Voice dictation is not supported in this browser'
                        : isListening
                          ? 'Stop listening'
                          : 'Dictate your question'
                    }
                    className={`h-10 w-10 sm:h-9 sm:w-9 rounded-md border inline-flex items-center justify-center transition-colors shrink-0 disabled:opacity-45 ${
                      isListening
                        ? 'bg-[#C8102E] border-[#C8102E] text-white hover:bg-[#991B1B]'
                        : 'bg-white border-[#DED4C8] text-slate-700 hover:border-[#C8102E] hover:text-[#C8102E]'
                    }`}
                  >
                    {isListening ? (
                      <Square className="w-3.5 h-3.5 fill-current" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="submit"
                    disabled={isAsking || !inputValue.trim()}
                    className="h-10 sm:h-9 px-3.5 rounded-md bg-[#C8102E] hover:bg-[#991B1B] disabled:opacity-45 text-white inline-flex items-center gap-1.5 text-xs font-medium transition-colors shrink-0 whitespace-nowrap"
                  >
                    <span>{isAsking ? 'Reading...' : 'Ask'}</span>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-1.5 px-1 text-[11px] text-slate-500 tabular-nums">
                  <span className="truncate">
                    Scope:{' '}
                    <strong className="font-medium text-slate-700">
                      {selectedDocIds.length === 1
                        ? selectedDocIds[0].includes('part-1')
                          ? 'CBS Manual 2026 Part I'
                          : selectedDocIds[0].includes('part-2')
                            ? 'CBS Manual 2026 Part II'
                            : '1 Selected File'
                        : selectedDocIds.length > 1
                          ? `${selectedDocIds.length} Selected Files`
                          : driveDocsCount > 0
                            ? `All Files (CBS Manual Part I & II + ${driveDocsCount} Folder Files)`
                            : 'CBS Manual 2026 (Part I & II)'}
                    </strong>
                  </span>
                  <span className="hidden sm:inline shrink-0">
                    Press Enter to ask · Shift+Enter for new line
                  </span>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Attribution Footer */}
        <footer className="shrink-0 bg-[#F6F1EA] border-t border-[#E6DDD1] px-3 sm:px-6 py-1.5 pb-safe text-center text-[11px] text-slate-600 font-medium">
          Prepared by Kalandi Charan Sahoo, PA, Dhenkanal RS SO
        </footer>
      </div>

      {/* Source Inspector Drawer/Modal */}
      <SourceInspectorModal
        page={inspectedPage}
        onClose={() => setInspectedPage(null)}
        onNavigatePage={(docId, pageNum) => openPageInspector(docId, pageNum)}
        isLoadingPage={isLoadingPage}
      />
    </div>
  );
}
