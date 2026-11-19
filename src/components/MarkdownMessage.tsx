import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownMessageProps {
  content: string;
  readingMode?: boolean;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({
  content,
  readingMode = false,
}) => {
  return (
    <div
      className={`cbs-markdown min-w-0 break-words text-slate-800 ${
        readingMode
          ? 'text-[15.5px] sm:text-[16px] leading-[1.8] space-y-3.5'
          : 'text-[14.5px] leading-[1.65] space-y-3'
      }`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-lg font-semibold text-slate-900 pt-2 pb-1 border-b border-[#E8DFD5]">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold text-slate-900 pt-2 pb-1 border-b border-[#E8DFD5]">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[15px] font-semibold text-slate-900 pt-1.5">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="text-slate-800 leading-relaxed">{children}</p>,
          ul: ({ children }) => (
            <ul className="list-disc pl-5 space-y-1.5 text-slate-800">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 space-y-1.5 text-slate-800">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed pl-0.5">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-slate-950">{children}</strong>
          ),
          code: ({ className, children }) => {
            const isBlock = Boolean(className);
            if (isBlock) {
              return (
                <code className="block bg-slate-900 text-stone-100 p-3 rounded-md font-mono text-xs overflow-x-auto leading-relaxed">
                  {children}
                </code>
              );
            }
            return (
              <code className="font-mono text-[12.5px] font-medium bg-[#FFF8DB] text-[#854D0E] border border-[#FDE047] px-1.5 py-0.5 rounded break-all sm:break-normal">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-md max-w-full">{children}</pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="bg-[#FAF7F2] border border-[#E8DFD5] rounded-md px-3.5 py-2.5 text-slate-700 text-[13.5px]">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto border border-[#E8DFD5] rounded-md bg-white max-w-full">
              <table className="min-w-full divide-y divide-[#E8DFD5] text-[13px]">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[#F6F1EA] text-slate-900">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left font-semibold text-slate-900 whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-slate-700 border-t border-stone-100 align-top tabular-nums">
              {children}
            </td>
          ),
          hr: () => <hr className="border-stone-200 my-3" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
