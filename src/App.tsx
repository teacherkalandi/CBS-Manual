import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  BookOpen,
  Check,
  Copy,
  FileText,
  Menu,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import { MarkdownMessage } from './components/MarkdownMessage';
import { SearchPanel } from './components/SearchPanel';
import { SidebarSources } from './components/SidebarSources';
import { SourceInspectorModal } from './components/SourceInspectorModal';
import type {
  ChatMessage,
  Citation,
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
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);

  const [activeTab, setActiveTab] = useState<'assistant' | 'search'>('assistant');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [inspectedPage, setInspectedPage] = useState<InspectedPage | null>(null);
  const [isLoadingPage, setIsLoadingPage] = useState(false);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch('/api/sources');
      if (!res.ok) return;
      const data = (await res.json()) as {
        bundledDocs?: IndexedDocumentMeta[];
      };
      if (data.bundledDocs) {
        setBundledDocs(data.bundledDocs);
      }
    } catch (err) {
      console.error('Failed to load sources:', err);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  // Poll briefly if bundled manuals are still indexing on very first boot
  useEffect(() => {
    if (bundledDocs.length >= 2) return;
    const timer = setTimeout(() => {
      fetchSources();
    }, 2000);
    return () => clearTimeout(timer);
  }, [bundledDocs.length, fetchSources]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      });

      const res = await fetch(`/api/page?${params.toString()}`);
      const data = (await res.json()) as InspectedPage & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Could not load manual page.');
      }
      setInspectedPage({ ...data, highlightQuery });
    } catch (err) {
      console.error(err);
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
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question,
          history: historyPayload,
          sourceScope: 'bundled',
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
                          bundledDocsCount: payload.bundledDocsCount,
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
    } finally {
      setIsAsking(false);
    }
  };

  const totalBundledPages = bundledDocs.reduce((acc, d) => acc + d.pageCount, 0);

  return (
    <div className="h-dvh w-full overflow-hidden flex bg-[#FAF7F2] text-slate-900">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block w-[280px] shrink-0 h-full">
        <SidebarSources
          bundledDocs={bundledDocs}
          selectedDocIds={selectedDocIds}
          onToggleDocSelection={handleToggleDocSelection}
          onSelectSingleDoc={(docId) => setSelectedDocIds([docId])}
          onClearDocSelection={() => setSelectedDocIds([])}
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
              selectedDocIds={selectedDocIds}
              onToggleDocSelection={handleToggleDocSelection}
              onSelectSingleDoc={(docId) => setSelectedDocIds([docId])}
              onClearDocSelection={() => setSelectedDocIds([])}
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
                  India Post POSB 2026 · {totalBundledPages || 748} pages saved &amp; ready
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
            sourceScope="bundled"
            accessToken={null}
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
                        All 748 pages of POSB CBS Manual 2026 Part I (Chapters 1–22) and Part II (Appendices I–XXIX) are permanently saved inside this tool for immediate answers.
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
                    {messages.map((msg) => (
                      <div key={msg.id} className="min-w-0">
                        {msg.role === 'user' ? (
                          <div className="flex justify-end">
                            <div className="max-w-[90%] sm:max-w-[85%] bg-[#B91C1C] text-white rounded-lg px-3.5 sm:px-4 py-2.5 text-sm leading-relaxed">
                              {msg.content}
                            </div>
                          </div>
                        ) : (
                          <div className="bg-white border border-[#E8DFD5] rounded-lg p-3.5 sm:p-5 space-y-4 min-w-0">
                            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[#F2EAE0]">
                              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                                <BookOpen className="w-3.5 h-3.5 text-[#C8102E]" />
                                <span>CBS Manual Reference Answer</span>
                              </div>
                              {!msg.isStreaming && msg.content && (
                                <button
                                  type="button"
                                  onClick={() => handleCopy(msg.id, msg.content)}
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 whitespace-nowrap"
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
                                    : 'Searching saved CBS Manual 2026...'}
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
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Composer */}
            <div className="shrink-0 bg-white border-t border-[#E8DFD5] px-3 sm:px-8 pt-2.5 pb-safe">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAsk();
                }}
                className="max-w-3xl mx-auto"
              >
                <div className="flex items-end gap-2 bg-[#FAF7F2] border border-[#DED4C8] focus-within:border-[#C8102E] rounded-lg p-1.5 sm:p-2 transition-colors">
                  <textarea
                    rows={1}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAsk();
                      }
                    }}
                    placeholder="Ask about CBS Manual 2026, Finacle menus..."
                    className="flex-1 resize-none bg-transparent text-base sm:text-sm text-slate-900 placeholder:text-slate-400 px-2 py-1.5 focus:outline-none max-h-36"
                  />
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
                          : 'CBS Manual 2026 Part II'
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
