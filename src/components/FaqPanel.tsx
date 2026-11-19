import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  MessageSquare,
  Search,
} from 'lucide-react';

interface FaqItem {
  id: string;
  category:
    | 'e-KYC & KYC'
    | 'TDS & Tax'
    | 'Limits & Fees'
    | 'Deceased Claims'
    | 'Schemes & BO'
    | 'Digital & SBCO';
  question: string;
  answer: string;
  reference: string;
  sbOrderPage?: number;
  aiPrompt: string;
}

interface FaqPanelProps {
  onAskAi: (prompt: string) => void;
  onInspectSbOrder: (pageNumber: number) => void;
}

const CATEGORIES: Array<'All' | FaqItem['category']> = [
  'All',
  'e-KYC & KYC',
  'TDS & Tax',
  'Limits & Fees',
  'Deceased Claims',
  'Schemes & BO',
  'Digital & SBCO',
];

const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'ekyc-biometric',
    category: 'e-KYC & KYC',
    question:
      'Which POSB schemes support paperless Aadhaar biometric e-KYC and what are the Finacle menus?',
    answer:
      'Paperless Aadhaar biometric e-KYC was launched pan-India w.e.f. 06.01.2025 via menus ECCRC, ECMRC, CASBAO, and CASBAM for CIF creation, Re-KYC, and Single Individual POSA opening/transactions (eliminating pay-in-slips for all biometric deposits and withdrawal forms for biometric withdrawals up to ₹5,000, with instant ledger posting). It was later extended to Single MIS, TD, KVP, and NSC w.e.f. 23.04.2025, and to RD & PPF account opening, deposits, RD/PPF loans, and PPF withdrawals irrespective of amount w.e.f. 27.06.2025. Always mask the first 8 digits of Aadhaar (XXXX-XXXX-1234) on physical forms.',
    reference: 'SB Order 01/2025, 07/2025 & 07A/2025',
    sbOrderPage: 10,
    aiPrompt:
      'Explain the complete paperless Aadhaar biometric e-KYC rules, eligible schemes, Finacle menus, and limits under SB Orders 01/2025, 07/2025, and 07A/2025.',
  },
  {
    id: 'aadhaar-pan-timeline',
    category: 'e-KYC & KYC',
    question:
      'What are the mandatory timelines for submitting Aadhaar and PAN under GSPR Amendment 2023?',
    answer:
      'Aadhaar must be submitted within 6 months of account opening (failing which the account becomes inoperative). If an account is opened with Form 60, PAN must be submitted within 2 months of crossing ₹50,000 balance, ₹1 lakh aggregate annual credits, or ₹10,000 monthly debits/transfers. Under SB Order 02/2024, Finacle validates PAN with Protean for Name match, DOB match, and Aadhaar-PAN linking status (Operative/Inoperative); non-matching or non-individual PANs cannot be accepted.',
    reference: 'SB Order 08/2023 & SB Order 02/2024',
    sbOrderPage: 8,
    aiPrompt:
      'What are the mandatory Aadhaar and PAN submission deadlines, Protean online PAN verification checks, and consequences of inoperative PAN under SB Orders 08/2023 and 02/2024?',
  },
  {
    id: 'kyc-risk-rekyc',
    category: 'e-KYC & KYC',
    question:
      'What are the KYC Risk Categories and Re-KYC periodicity for POSB accounts?',
    answer:
      'Under Master Circular No. 2 on KYC/AML/CFT (Appendix-I), Risk Categories are: Low Risk (balance/investment ≤ ₹50,000 — Re-KYC every 7 years), Medium Risk (> ₹50,000 to ₹10 lakh — Re-KYC every 5 years), and High Risk (> ₹10 lakh — Re-KYC every 2 years with mandatory Source of Funds proof). Additionally, a single mobile number is capped at a maximum of 5 CIFs (SB Order 17/2022), and counter transactions are blocked if mobile number is missing in CIF (SB Order 22/2022).',
    reference: 'SB Order 12/2023, 17/2022 & 22/2022',
    sbOrderPage: 8,
    aiPrompt:
      'Summarize KYC Risk Categories, Re-KYC periodicity, Source of Funds requirements, and mobile number rules under SB Order 12/2023 and CBS Manual 2026.',
  },
  {
    id: 'tds-194a-194h-2025',
    category: 'TDS & Tax',
    question:
      'What are the latest TDS thresholds for Interest (194A), Agent Commission (194H), and NSS-87 withdrawals?',
    answer:
      'Under Finance Act 2025 (SB Order 06/2025): (1) Section 194A Interest TDS annual threshold is raised to ₹1,00,000 for Senior Citizens and ₹50,000 for Others (applicable to SCSS, MSSC, etc.). (2) Section 194H Agent Commission TDS rate is 2% (reduced permanently from 5% vide SB Order 09/2024) and annual threshold is raised from ₹15,000 to ₹20,000. (3) Section 80CCA: Withdrawals by individuals from NSS-87 accounts on or after 29.08.2024 are exempt from income tax.',
    reference: 'SB Order 06/2025 & SB Order 09/2024',
    sbOrderPage: 10,
    aiPrompt:
      'Explain all updated TDS thresholds and rates under Sections 194A, 194H, 194N, and Section 80CCA NSS-87 exemption as per SB Order 06/2025 and CBS Manual 2026.',
  },
  {
    id: 'tds-194n',
    category: 'TDS & Tax',
    question:
      'How does TDS on cash withdrawals under Section 194N work in Finacle?',
    answer:
      'For ITR filers, 2% TDS applies on aggregate cash withdrawals exceeding ₹1 crore in a financial year. For non-ITR filers (not filed ITR for the preceding 3 assessment years), TDS is 2% on cash withdrawals from ₹20 lakh to ₹1 crore and 5% above ₹1 crore. ITR filing status is captured in Finacle via the CITFM menu, which automates lien marking and TDS deduction. Always use HCRT (not CTM) for transaction reversals.',
    reference: 'SB Order 05/2021 & SB Order 18/2022',
    sbOrderPage: 7,
    aiPrompt:
      'Explain Section 194N cash withdrawal TDS thresholds, CITFM menu procedure, and HCRT reversal instructions in Finacle.',
  },
  {
    id: 'nomination-fee-abolished',
    category: 'Limits & Fees',
    question:
      'Is there still a ₹50 fee for changing or cancelling nomination in POSB accounts?',
    answer:
      'No. Under SB Order 05/2025 (dated 03.04.2025), Schedule-II of GSPR 2018 was amended to abolish the ₹50 + GST fee for cancellation or change of nomination w.e.f. 02.04.2025. Other Schedule-II fees collected via HGCHRG remain: Duplicate Passbook ₹50+GST, Account Statement/Deposit Receipt ₹20+GST, Account Transfer ₹100+GST, Pledging ₹100+GST, and Cheque Book leaves beyond free limit ₹2/leaf+GST.',
    reference: 'SB Order 05/2025 & SB Order 03/2020',
    sbOrderPage: 10,
    aiPrompt:
      'List all current GSPR Schedule-II service fees collected in Finacle via HGCHRG, including the abolition of nomination change fee under SB Order 05/2025.',
  },
  {
    id: 'scheme-limits-scss-mis',
    category: 'Limits & Fees',
    question:
      'What are the maximum investment limits for SCSS, MIS, SSA, PPF, and Joint POSA accounts?',
    answer:
      'SCSS maximum limit is ₹30 lakh (SB Order 06/2023). MIS maximum limit is ₹9 lakh for Single and ₹15 lakh for Joint accounts (SB Order 07/2023; guardian minor account limit is separate per SB Order 08/2016). SSA minimum deposit is ₹250 (multiples of ₹50) and maximum ₹1.5 lakh/year; PPF minimum ₹500 (multiples of ₹50), max ₹1.5 lakh/year. Up to 3 adults can open a Joint Post Office Savings Account (SB Order 16/2023). POSA minimum balance is ₹500 with ₹50 (incl. GST) annual maintenance fee if below ₹500 (zero-balance Basic Savings allowed for Govt welfare beneficiaries).',
    reference: 'SB Orders 06/2023, 07/2023, 16/2023 & 08/2021',
    sbOrderPage: 8,
    aiPrompt:
      'Provide a table of current minimum and maximum deposit limits, multiples, and maintenance fees across POSA, RD, TD, MIS, SCSS, PPF, SSA, NSC, and KVP.',
  },
  {
    id: 'deceased-claim-quick',
    category: 'Deceased Claims',
    question:
      'What are the timelines, sanction limits, and simplified rules for Deceased Claim settlement?',
    answer:
      'Under SB Order 01/2023: Settle claims within 1 working day (with nomination) and 7 working days (without nomination). No separate sanction memo is to be issued (record sanction directly on Part-II of Form-11). Routine inquiry via PRI(P)/SDI(P) is prohibited when documents are complete, and physical presence of witnesses is waived if signed on KYC copies. Sanction limits without legal evidence go up to ₹5 lakh (TS SPM ₹5,000; LSG/PM Gr-I ₹10,000; HSG/PM Gr-II/III ₹25,000; Gr-B SPO ₹1L; Gr-A SSPO ₹2.5L; Dir/RD ₹3.75L; PMG/CPMG ₹5L). Above ₹5 lakh, a Tahsildar-issued Legal Heir Certificate is accepted (SB Order 16/2023).',
    reference: 'SB Orders 05/2019, 31/2020, 01/2023 & 16/2023',
    sbOrderPage: 8,
    aiPrompt:
      'Explain the step-by-step Finacle procedure, documents, sanction limits, and timelines for settling Deceased Claim cases with nomination, without nomination, and with legal evidence.',
  },
  {
    id: 'authorized-person-jointb',
    category: 'Deceased Claims',
    question:
      'Can a messenger or authorized person withdraw money, and how do Joint "B" accounts operate?',
    answer:
      'Routine payment via messenger is barred under Rule 12 of GSPR 2018 (SB Order 15/2021). However, SB Order 23/2021 allows Senior Citizens and ill, infirm, or differently-abled depositors to transact via a literate authorized person using Form-12 (payment via account payee cheque or PO/Bank savings credit; cash allowed only for SB withdrawals). In Joint "B" accounts (SB Order 12/2021), either holder or survivor can perform all operations across all schemes EXCEPT SCSS, where the first holder signature is mandatory for all actions other than quarterly interest withdrawal.',
    reference: 'SB Orders 12/2021, 15/2021 & 23/2021',
    sbOrderPage: 6,
    aiPrompt:
      'Explain Form-12 authorized person withdrawal rules (SB Order 23/2021) and Joint "A" vs Joint "B" operational rules including SCSS exceptions.',
  },
  {
    id: 'mssc-sunset-40wd',
    category: 'Schemes & BO',
    question:
      'Can new Mahila Samman Savings Certificate (MSSC) accounts be opened now, and how is the 40% withdrawal processed?',
    answer:
      'No new MSSC accounts or deposits are accepted after 31.03.2025 (sunset confirmed via SB Order 03/2025). For existing MSSC accounts that have completed 1 year, a one-time 40% partial withdrawal is processed in Finacle via menu HCAACTD using closure reason code MSWD and verified via HCAACVTD (SB Order 02/2025). Premature closure without reason is allowed after 6 months with a 2% interest penalty (5.5% instead of 7.5%).',
    reference: 'SB Orders 05/2023, 02/2025 & 03/2025',
    sbOrderPage: 10,
    aiPrompt:
      'Explain the MSSC 2023 sunset rules, 40% partial withdrawal Finacle steps (HCAACTD / MSWD), and premature closure rules.',
  },
  {
    id: 'nss-irregular-inop',
    category: 'Schemes & BO',
    question:
      'What is the current interest rate on NSS-87/92, and what are the rules for irregular accounts and INOP freezing?',
    answer:
      'Under SB Order 07/2024, all NSS-87 and NSS-92 balances earn 0% interest from 01.10.2024 (inter-HO transfer permitted for closure via SB Order 14/2021). Under SB Order 05/2024, MoF issued regularization norms for 6 irregular categories (NSS, minor PPF, multiple PPF, NRI PPF 1968 rules, minor accounts, and SSA opened by grandparents). Under SB Order 10/2025, matured unclosed accounts (MIS, SCSS, TD, KVP, NSC, RD, PPF) completing 3 years post-maturity are frozen under code INOP twice a year within 15 days starting 1st July and 1st January.',
    reference: 'SB Orders 05/2024, 07/2024 & 10/2025',
    sbOrderPage: 9,
    aiPrompt:
      'Detail the 6 irregular account regularization guidelines under SB Order 05/2024, NSS-87/92 zero interest rules, and bi-annual INOP freezing under SB Order 10/2025.',
  },
  {
    id: 'bo-transaction-limits',
    category: 'Schemes & BO',
    question:
      'What are the daily cash deposit, withdrawal, and inter-SOL transaction limits for GDS Branch Post Offices (BOs)?',
    answer:
      'At GDS Branch Post Offices: per-individual cash withdrawal limit without Account Office sanction is ₹20,000 (SB Order 02/2021). Daily cash deposit limit at BOs and daily inter-SOL cash transaction limit at other SOLs are ₹50,000 (SB Order 03/2021; inter-SOL cash withdrawal by POSB cheque remains capped at ₹25,000/day, while cheque credit at other SOLs has no upper cap per SB Order 12/2019). Account payee bank cheques (no upper limit) are accepted in BOs for RD/TD/SSA/SB/MIS/SCSS/KVP/NSC/PPF (SB Orders 22/2020 & 27/2020).',
    reference: 'SB Orders 02/2021, 03/2021, 22/2020 & 27/2020',
    sbOrderPage: 6,
    aiPrompt:
      'List all cash deposit, withdrawal, cheque, and inter-SOL transaction limits for GDS Branch Post Offices (BOs) and Sub/Head Post Offices.',
  },
  {
    id: 'digital-neft-ecs-cert',
    category: 'Digital & SBCO',
    question:
      'What is the India Post IFSC code for NEFT/RTGS, and how can customers download Interest Certificates or receive ECS credits?',
    answer:
      'India Post POSB IFSC code is IPOS0000DOP (24×7 NEFT/RTGS via IPPB sponsorship; works for transferring bank funds directly into POSA, PPF, or SSA per SB Orders 08/2022 & 09/2023). DOP Internet Banking users can directly download Interest Certificates for current and previous financial years under the Accounts tab (SB Order 08/2025), and open/close NSC, KVP, PPF, MIS, and SCSS online. For closures and MIS/SCSS/TD interest payouts, ECS outward credit (HOTCE menu) into a PO Savings or Bank Account is mandatory (SB Orders 04/2022 & 23/2022).',
    reference: 'SB Orders 08/2022, 23/2022, 06/2024 & 08/2025',
    sbOrderPage: 10,
    aiPrompt:
      'Explain NEFT/RTGS with IPOS0000DOP, ECS outward credit (HOTCE), e-Passbook, and Internet Banking services including online Interest Certificate download.',
  },
  {
    id: 'sbco-hiarm-rules',
    category: 'Digital & SBCO',
    question:
      'What are the revised SBCO checking duties and the restriction on the Finacle HIARM menu?',
    answer:
      'Under SB Order 04/2021 (CBS-CSI offices), SBCO checks vouchers against the Common Long Book (Long Book Detailed Report-BRN) instead of HO/SO Cash Books, and must perform daily verification of CSI manual entries via ZFI_DOC_LOG. Under SB Order 03/2024, HIARM/HACINT menus are strictly restricted to interest adjustments only — principal balance adjustments or fraud restorations must use back-value date relaxation, never HIARM.',
    reference: 'SB Order 04/2021 & SB Order 03/2024',
    sbOrderPage: 9,
    aiPrompt:
      'Explain the revised daily and periodical SBCO checking procedures (SB Order 04/2021) and HIARM/HACINT restrictions (SB Order 03/2024).',
  },
];

export const FaqPanel: React.FC<FaqPanelProps> = ({
  onAskAi,
  onInspectSbOrder,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<
    'All' | FaqItem['category']
  >('All');
  const [expandedIds, setExpandedIds] = useState<string[]>([FAQ_ITEMS[0].id]);

  const filteredFaqs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return FAQ_ITEMS.filter((item) => {
      if (selectedCategory !== 'All' && item.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      return (
        item.question.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q) ||
        item.reference.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [searchQuery, selectedCategory]);

  const toggleItem = (id: string) => {
    setExpandedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-8 py-4 sm:py-6">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Header & Search Card */}
        <div className="bg-white border border-[#E8DFD5] rounded-lg p-3.5 sm:p-5 space-y-3.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-[#C8102E] shrink-0" />
                <h2 className="text-base font-semibold text-slate-900">
                  Frequently Asked Questions (F&amp;Q)
                </h2>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                Quick reference answers updated from POSB CBS Manual 2026 &amp; Notes on SB Orders (2016–2025).
              </p>
            </div>
            <span className="text-[11px] font-medium text-slate-500 tabular-nums shrink-0">
              {filteredFaqs.length} of {FAQ_ITEMS.length} topics
            </span>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter F&Q by scheme, SB Order (e.g. 06/2025), Finacle menu, or keyword..."
              className="w-full h-10 pl-9 pr-3 text-base sm:text-sm bg-[#FAF7F2] border border-[#DED4C8] rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#C8102E]"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((category) => {
              const active = selectedCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setSelectedCategory(category)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#C8102E] text-white'
                      : 'bg-[#F6F1EA] text-slate-700 hover:bg-[#EDE4D8] border border-[#E2D8CB]'
                  }`}
                >
                  {category}
                </button>
              );
            })}
          </div>
        </div>

        {/* Accordion List */}
        {filteredFaqs.length === 0 ? (
          <div className="bg-white border border-[#E8DFD5] rounded-lg p-8 text-center space-y-2">
            <p className="text-sm font-medium text-slate-800">
              No matching F&amp;Q found for &ldquo;{searchQuery}&rdquo;
            </p>
            <button
              type="button"
              onClick={() => onAskAi(searchQuery)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#C8102E] hover:bg-[#991B1B] text-white text-xs font-medium transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Ask AI across All Files</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2.5 pb-4">
            {filteredFaqs.map((item) => {
              const isOpen = expandedIds.includes(item.id);
              return (
                <div
                  key={item.id}
                  className={`bg-white border rounded-lg transition-colors ${
                    isOpen ? 'border-[#D9B8B8]' : 'border-[#E8DFD5]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleItem(item.id)}
                    aria-expanded={isOpen}
                    className="w-full text-left px-4 py-3.5 flex items-start justify-between gap-3 hover:bg-[#FFFDF9] rounded-lg transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#991B1B] bg-red-50 border border-red-200/70 rounded px-1.5 py-0.5">
                          {item.category}
                        </span>
                        <span className="text-[11px] font-medium text-slate-500">
                          {item.reference}
                        </span>
                      </div>
                      <div className="text-sm font-semibold text-slate-900 leading-snug">
                        {item.question}
                      </div>
                    </div>
                    <span className="mt-1 text-slate-400 shrink-0">
                      {isOpen ? (
                        <ChevronUp className="w-4 h-4 text-[#C8102E]" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 border-t border-[#F2EAE0] space-y-3">
                      <p className="text-[13.5px] text-slate-700 leading-relaxed">
                        {item.answer}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => onAskAi(item.aiPrompt)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#C8102E] hover:bg-[#991B1B] text-white text-xs font-medium transition-colors"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>Ask AI for Full Procedure</span>
                        </button>
                        {item.sbOrderPage && (
                          <button
                            type="button"
                            onClick={() => onInspectSbOrder(item.sbOrderPage!)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#DED4C8] bg-[#FAF7F2] hover:bg-[#FFF8DB] hover:border-[#F59E0B] text-slate-800 text-xs font-medium transition-colors"
                          >
                            <BookOpen className="w-3.5 h-3.5 text-[#C8102E]" />
                            <span>
                              Read SB Order Notes (Year{' '}
                              {2015 + item.sbOrderPage})
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
