import { jsPDF } from 'jspdf';
import type { Citation } from '../types';

export interface AnswerExportPayload {
  question: string;
  answer: string;
  citations?: Citation[];
}

function buildFilename(question: string, ext: 'pdf' | 'doc'): string {
  const slug = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const dateTag = new Date().toISOString().slice(0, 10);
  return `CBS-Manual-${slug || 'Answer'}-${dateTag}.${ext}`;
}

function sanitizePdfText(input: string): string {
  return input
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/₹/g, 'Rs. ')
    .replace(/[^\x20-\x7E\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatInlineMarkdownToHtml(raw: string): string {
  let html = escapeHtml(raw);
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="font-family:Consolas,Courier New,monospace;background:#FEF3C7;color:#92400E;padding:1px 4px;border-radius:3px;font-size:10pt;">$1</code>',
  );
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return html;
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  return /^\|?[\s:-]+\|[\s|:-]*$/.test(trimmed) && trimmed.includes('-');
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function markdownToWordHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const htmlParts: string[] = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      htmlParts.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      htmlParts.push('</ol>');
      inOl = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      closeLists();
      continue;
    }

    // Markdown table block
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparatorLine(lines[i + 1])
    ) {
      closeLists();
      const headers = parseTableRow(trimmed);
      i += 1; // skip separator
      const rows: string[][] = [];
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (!nextLine || !nextLine.includes('|')) break;
        rows.push(parseTableRow(nextLine));
        i += 1;
      }

      htmlParts.push(
        '<table style="width:100%;border-collapse:collapse;margin:10px 0 14px 0;font-size:10pt;">',
      );
      htmlParts.push('<thead><tr>');
      for (const h of headers) {
        htmlParts.push(
          `<th style="border:1px solid #D6CFC5;background:#F6F1EA;color:#7F1D1D;text-align:left;padding:6px 8px;font-weight:bold;">${formatInlineMarkdownToHtml(h)}</th>`,
        );
      }
      htmlParts.push('</tr></thead><tbody>');
      for (const row of rows) {
        htmlParts.push('<tr>');
        for (let c = 0; c < headers.length; c++) {
          htmlParts.push(
            `<td style="border:1px solid #D6CFC5;padding:6px 8px;vertical-align:top;">${formatInlineMarkdownToHtml(row[c] ?? '')}</td>`,
          );
        }
        htmlParts.push('</tr>');
      }
      htmlParts.push('</tbody></table>');
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeLists();
      htmlParts.push(
        '<hr style="border:none;border-top:1px solid #E2D9CD;margin:12px 0;" />',
      );
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      closeLists();
      const level = headingMatch[1].length;
      const content = formatInlineMarkdownToHtml(headingMatch[2]);
      const sizes: Record<number, string> = {
        1: '15pt',
        2: '13pt',
        3: '11.5pt',
        4: '10.5pt',
      };
      htmlParts.push(
        `<h${level} style="color:#991B1B;font-size:${sizes[level] || '11pt'};margin:14px 0 6px 0;font-weight:bold;">${content}</h${level}>`,
      );
      continue;
    }

    // Unordered list item
    const ulMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    if (ulMatch) {
      if (inOl) {
        htmlParts.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        htmlParts.push('<ul style="margin:6px 0 10px 20px;padding:0;">');
        inUl = true;
      }
      htmlParts.push(
        `<li style="margin:4px 0;line-height:1.5;">${formatInlineMarkdownToHtml(ulMatch[1])}</li>`,
      );
      continue;
    }

    // Ordered list item
    const olMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (olMatch) {
      if (inUl) {
        htmlParts.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        htmlParts.push('<ol style="margin:6px 0 10px 20px;padding:0;">');
        inOl = true;
      }
      htmlParts.push(
        `<li style="margin:4px 0;line-height:1.5;">${formatInlineMarkdownToHtml(olMatch[1])}</li>`,
      );
      continue;
    }

    closeLists();
    htmlParts.push(
      `<p style="margin:6px 0 8px 0;line-height:1.55;">${formatInlineMarkdownToHtml(trimmed)}</p>`,
    );
  }

  closeLists();
  return htmlParts.join('\n');
}

const FOOTER_CREDIT =
  'Prepared by Kalandi Charan Sahoo, PA, Dhenkanal RS SO';

export function downloadAnswerAsDoc({
  question,
  answer,
  citations,
}: AnswerExportPayload): void {
  const generatedOn = new Date().toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const bodyHtml = markdownToWordHtml(answer);

  const citationsHtml =
    citations && citations.length > 0
      ? `
      <div style="margin-top:18px;padding-top:12px;border-top:2px solid #E6DDD1;">
        <h3 style="color:#991B1B;font-size:11pt;margin:0 0 8px 0;">Referenced Pages &amp; Sources</h3>
        <ul style="margin:0 0 0 18px;padding:0;font-size:9.5pt;color:#334155;">
          ${citations
            .slice(0, 8)
            .map(
              (c) =>
                `<li style="margin:4px 0;"><strong>${escapeHtml(c.shortName)} — Page ${c.pageNumber}</strong>${
                  c.snippet ? `: ${escapeHtml(c.snippet)}` : ''
                }</li>`,
            )
            .join('')}
        </ul>
      </div>`
      : '';

  const wordHtml = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8" />
  <title>CBS Manual 2026 Reference Answer</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 16mm 18mm 16mm;
    }
    body {
      font-family: Calibri, Arial, sans-serif;
      font-size: 10.5pt;
      color: #1E293B;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div style="background:#B91C1C;color:#FFFFFF;padding:12px 16px;border-bottom:4px solid #FFCD00;margin-bottom:14px;">
    <div style="font-size:13pt;font-weight:bold;">India Post · POSB CBS Manual 2026 AI Assistant</div>
    <div style="font-size:9pt;color:#FEE2E2;margin-top:2px;">Reference Answer Export · Generated on ${escapeHtml(generatedOn)}</div>
  </div>

  ${
    question.trim()
      ? `<div style="background:#FAF7F2;border-left:4px solid #B91C1C;padding:10px 12px;margin-bottom:14px;">
          <div style="font-size:8.5pt;font-weight:bold;text-transform:uppercase;color:#991B1B;margin-bottom:3px;">Question</div>
          <div style="font-size:10.5pt;font-weight:bold;color:#0F172A;">${escapeHtml(question.trim())}</div>
        </div>`
      : ''
  }

  <div>
    ${bodyHtml}
  </div>

  ${citationsHtml}

  <div style="margin-top:20px;padding-top:10px;border-top:1px solid #E6DDD1;font-size:9pt;color:#64748B;text-align:center;">
    ${escapeHtml(FOOTER_CREDIT)}
  </div>
</body>
</html>`;

  const blob = new Blob(['\ufeff', wordHtml], {
    type: 'application/msword;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildFilename(question, 'doc');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createAnswerPdf({
  question,
  answer,
  citations,
}: AnswerExportPayload): { doc: jsPDF; filename: string } {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;
  const bottomLimit = pageHeight - 16;

  // Header Banner (India Post Crimson + Dak Yellow Accent)
  doc.setFillColor(185, 28, 28);
  doc.rect(0, 0, pageWidth, 22, 'F');
  doc.setFillColor(255, 205, 0);
  doc.rect(0, 22, pageWidth, 1.8, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('India Post - POSB CBS Manual 2026 Reference', marginX, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const generatedOn = new Date().toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`CBS Manual AI Assistant | Exported ${generatedOn}`, marginX, 17.5);

  let y = 30;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > bottomLimit) {
      doc.addPage();
      y = 16;
    }
  };

  // Question Box
  const cleanQuestion = sanitizePdfText(question);
  if (cleanQuestion) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const qLines = doc.splitTextToSize(cleanQuestion, contentWidth - 8);
    const boxHeight = 8 + qLines.length * 4.8;
    ensureSpace(boxHeight + 4);

    doc.setFillColor(250, 247, 242);
    doc.setDrawColor(232, 223, 213);
    doc.roundedRect(marginX, y, contentWidth, boxHeight, 1.5, 1.5, 'FD');
    doc.setFillColor(185, 28, 28);
    doc.rect(marginX, y, 1.8, boxHeight, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(153, 27, 27);
    doc.text('QUESTION', marginX + 5, y + 4.8);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(qLines, marginX + 5, y + 9.8);
    y += boxHeight + 6;
  }

  // Answer Markdown Body
  const lines = answer.replace(/\r\n/g, '\n').split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      y += 2.2;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      ensureSpace(5);
      doc.setDrawColor(226, 217, 205);
      doc.line(marginX, y + 1.5, pageWidth - marginX, y + 1.5);
      y += 4.5;
      continue;
    }

    // Markdown table
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparatorLine(lines[i + 1])
    ) {
      const headers = parseTableRow(trimmed).map(sanitizePdfText);
      i += 1; // skip separator
      const rows: string[][] = [];
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (!nextLine || !nextLine.includes('|')) break;
        rows.push(parseTableRow(nextLine).map(sanitizePdfText));
        i += 1;
      }

      const colCount = Math.max(1, headers.length);
      const colWidth = contentWidth / colCount;
      const drawTableRow = (cells: string[], isHeader: boolean) => {
        doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
        doc.setFontSize(8.5);
        const wrappedCells = Array.from({ length: colCount }, (_, c) =>
          doc.splitTextToSize(cells[c] || '', colWidth - 3),
        );
        const maxLines = Math.max(1, ...wrappedCells.map((wc) => wc.length));
        const rowHeight = maxLines * 4.1 + 3.2;
        ensureSpace(rowHeight + 1);

        if (isHeader) {
          doc.setFillColor(246, 241, 234);
          doc.rect(marginX, y, contentWidth, rowHeight, 'F');
        }
        doc.setDrawColor(214, 207, 197);
        for (let c = 0; c < colCount; c++) {
          const cellX = marginX + c * colWidth;
          doc.rect(cellX, y, colWidth, rowHeight, 'S');
          doc.setTextColor(isHeader ? 127 : 30, isHeader ? 29 : 41, isHeader ? 29 : 59);
          doc.text(wrappedCells[c], cellX + 1.5, y + 4.2);
        }
        y += rowHeight;
      };

      y += 1.5;
      drawTableRow(headers, true);
      for (const row of rows) {
        drawTableRow(row, false);
      }
      y += 4;
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = sanitizePdfText(headingMatch[2]);
      const fontSize = level === 1 ? 12.5 : level === 2 ? 11.5 : 10.5;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(fontSize);
      const wrapped = doc.splitTextToSize(headingText, contentWidth);
      const blockHeight = wrapped.length * (fontSize * 0.46) + 3;
      ensureSpace(blockHeight + 2);
      y += 2;
      doc.setTextColor(153, 27, 27);
      doc.text(wrapped, marginX, y);
      y += blockHeight;
      continue;
    }

    // Bullet item
    const ulMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    if (ulMatch) {
      const itemText = sanitizePdfText(ulMatch[1]);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      const wrapped = doc.splitTextToSize(itemText, contentWidth - 6);
      const blockHeight = wrapped.length * 4.5 + 1.4;
      ensureSpace(blockHeight);
      doc.setTextColor(185, 28, 28);
      doc.text('-', marginX + 2, y);
      doc.setTextColor(30, 41, 59);
      doc.text(wrapped, marginX + 6, y);
      y += blockHeight;
      continue;
    }

    // Numbered list item
    const olMatch = trimmed.match(/^(\d+[.)])\s+(.+)$/);
    if (olMatch) {
      const prefix = olMatch[1];
      const itemText = sanitizePdfText(olMatch[2]);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      const wrapped = doc.splitTextToSize(itemText, contentWidth - 8);
      const blockHeight = wrapped.length * 4.5 + 1.4;
      ensureSpace(blockHeight);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(153, 27, 27);
      doc.text(prefix, marginX + 1, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 41, 59);
      doc.text(wrapped, marginX + 8, y);
      y += blockHeight;
      continue;
    }

    // Regular paragraph
    const paraText = sanitizePdfText(trimmed);
    if (!paraText) continue;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const wrapped = doc.splitTextToSize(paraText, contentWidth);
    const blockHeight = wrapped.length * 4.6 + 1.8;
    ensureSpace(blockHeight);
    doc.setTextColor(30, 41, 59);
    doc.text(wrapped, marginX, y);
    y += blockHeight;
  }

  // Referenced Pages & Sources
  if (citations && citations.length > 0) {
    ensureSpace(16);
    y += 4;
    doc.setDrawColor(230, 221, 209);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(153, 27, 27);
    doc.text('Referenced Pages & Sources', marginX, y);
    y += 5.5;

    for (const cit of citations.slice(0, 8)) {
      const label = sanitizePdfText(
        `${cit.shortName} (Page ${cit.pageNumber})${cit.snippet ? ` - ${cit.snippet}` : ''}`,
      );
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      const wrapped = doc.splitTextToSize(label, contentWidth - 5);
      const blockHeight = wrapped.length * 4 + 1.5;
      ensureSpace(blockHeight);
      doc.setTextColor(185, 28, 28);
      doc.text('-', marginX + 1.5, y);
      doc.setTextColor(71, 85, 105);
      doc.text(wrapped, marginX + 5, y);
      y += blockHeight;
    }
  }

  // Footer with attribution & page numbers
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 113, 108);
    doc.text(FOOTER_CREDIT, marginX, pageHeight - 8);
    doc.text(
      `Page ${p} of ${totalPages}`,
      pageWidth - marginX,
      pageHeight - 8,
      { align: 'right' },
    );
  }

  return { doc, filename: buildFilename(question, 'pdf') };
}

export function downloadAnswerAsPdf(payload: AnswerExportPayload): void {
  const { doc, filename } = createAnswerPdf(payload);
  doc.save(filename);
}

export async function shareAnswerPdfOnWhatsApp(
  payload: AnswerExportPayload,
): Promise<'shared' | 'downloaded-and-opened' | 'cancelled'> {
  const { doc, filename } = createAnswerPdf(payload);
  const pdfBlob = doc.output('blob');
  const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });

  const cleanQ = payload.question.trim();
  const shortSummary = sanitizePdfText(payload.answer).slice(0, 1100);
  const shareText = [
    '*India Post · POSB CBS Manual 2026 Reference*',
    cleanQ ? `*Q:* ${cleanQ}` : '',
    '',
    shortSummary + (payload.answer.length > 1100 ? '...' : ''),
    '',
    `_${FOOTER_CREDIT}_`,
  ]
    .filter((line, idx, arr) => line !== '' || (idx > 0 && arr[idx - 1] !== ''))
    .join('\n');

  // 1. Direct PDF file share via Web Share API (works natively with WhatsApp on mobile & supported browsers)
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function'
  ) {
    try {
      const canShareFiles =
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [pdfFile] });

      if (canShareFiles) {
        await navigator.share({
          title: cleanQ || 'CBS Manual 2026 Reference Answer',
          text: cleanQ
            ? `POSB CBS Manual 2026 Reference: ${cleanQ}`
            : 'POSB CBS Manual 2026 Reference Answer (PDF)',
          files: [pdfFile],
        });
        return 'shared';
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return 'cancelled';
      }
      // Fall through to PDF download + WhatsApp link on restricted/desktop contexts
    }
  }

  // 2. Fallback for desktop/iframe: download the PDF immediately and open WhatsApp with the summary
  doc.save(filename);

  const waUrl = `https://wa.me/?text=${encodeURIComponent(
    `${shareText}\n\n(Attach downloaded PDF: ${filename})`,
  )}`;
  const link = document.createElement('a');
  link.href = waUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return 'downloaded-and-opened';
}

