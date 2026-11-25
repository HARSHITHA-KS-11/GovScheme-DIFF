import React, { useState } from 'react';
import { Phone, Shield, ExternalLink, Search, Info, Clock, Globe, Building2 } from 'lucide-react';

import { useLanguage } from '../context/LanguageContext';
import { saveStorage, loadStorage, clearFeatureStorage } from '../utils/persistence';

interface SchemePortalEntry {
  category: 'Central Scheme Portals' | 'Welfare & Pensions' | 'Education & Scholarships' | 'Health & Insurance' | 'Agriculture & Rural' | 'State & Citizen Services';
  jurisdiction: string;
  name: string;
  description: string;
  helpline: string;
  portalUrl: string;
  portalLabel: string;
}

const SCHEME_PORTAL_DIRECTORY: SchemePortalEntry[] = [
  {
    category: 'Central Scheme Portals',
    jurisdiction: 'All India • Central & State Schemes',
    name: 'myScheme — National Government Scheme Discovery Portal',
    description: 'Search central and state welfare schemes by age, income, state, category, and education level, and check application requirements.',
    helpline: 'UMANG Helpline: 1800-11-1555',
    portalUrl: 'https://www.myscheme.gov.in',
    portalLabel: 'myscheme.gov.in',
  },
  {
    category: 'Central Scheme Portals',
    jurisdiction: 'All India • Single Citizen Services Hub',
    name: 'UMANG Portal & Citizen Helpdesk',
    description: 'Access central and state scheme applications, EPFO passbooks, pension updates, ration card services, and grievance tracking in one place.',
    helpline: 'Toll-Free: 1800-11-1555',
    portalUrl: 'https://web.umang.gov.in',
    portalLabel: 'web.umang.gov.in',
  },
  {
    category: 'Education & Scholarships',
    jurisdiction: 'All India • Ministry of Education & Welfare Ministries',
    name: 'National Scholarship Portal (NSP)',
    description: 'Apply for Pre-Matric, Post-Matric, and Merit-cum-Means scholarships, check institutional verification, and track DBT disbursal.',
    helpline: 'Helpdesk: 0120-6619540',
    portalUrl: 'https://scholarships.gov.in',
    portalLabel: 'scholarships.gov.in',
  },
  {
    category: 'Health & Insurance',
    jurisdiction: 'All India • National Health Authority',
    name: 'Ayushman Bharat (PM-JAY) Beneficiary Portal',
    description: 'Check family eligibility under PM-JAY, search empanelled hospitals, complete e-KYC, and download your Ayushman card.',
    helpline: 'Toll-Free: 14555',
    portalUrl: 'https://beneficiary.nha.gov.in',
    portalLabel: 'beneficiary.nha.gov.in',
  },
  {
    category: 'Agriculture & Rural',
    jurisdiction: 'All India • Ministry of Agriculture & Farmers Welfare',
    name: 'PM-KISAN Samman Nidhi Citizen Portal',
    description: 'Complete farmer self-registration, verify Aadhaar & bank seeding status, and view beneficiary payment installments.',
    helpline: 'Toll-Free: 155261 / 011-24300606',
    portalUrl: 'https://pmkisan.gov.in',
    portalLabel: 'pmkisan.gov.in',
  },
  {
    category: 'Welfare & Pensions',
    jurisdiction: 'All India • Ministry of Labour & Employment',
    name: 'e-Shram Unorganised Worker Portal',
    description: 'Register for a Universal Account Number (UAN), access social security benefits, and link employment and pension schemes.',
    helpline: 'Toll-Free: 14434',
    portalUrl: 'https://eshram.gov.in',
    portalLabel: 'eshram.gov.in',
  },
  {
    category: 'State & Citizen Services',
    jurisdiction: 'All India • Public Grievance Redressal',
    name: 'CPGRAMS — Centralised Public Grievance Portal',
    description: 'Submit formal complaints and track department responses if a government scheme application, pension, or benefit transfer is delayed.',
    helpline: 'Online Grievance Tracking Portal',
    portalUrl: 'https://pgportal.gov.in',
    portalLabel: 'pgportal.gov.in',
  },
  {
    category: 'State & Citizen Services',
    jurisdiction: 'Karnataka • State Citizen Portal',
    name: 'Seva Sindhu — Government of Karnataka Guarantee & Welfare Portal',
    description: 'Official Karnataka state portal for guarantee schemes, income/caste certificates, pension applications, and status tracking.',
    helpline: 'State Helpdesk: 080-22279954 / 1902',
    portalUrl: 'https://sevasindhu.karnataka.gov.in',
    portalLabel: 'sevasindhu.karnataka.gov.in',
  },
  {
    category: 'State & Citizen Services',
    jurisdiction: 'Delhi • NCT e-Governance Services',
    name: 'Delhi e-District Citizen Portal',
    description: 'Apply online for income certificates, domicile proofs, social welfare pensions, and verified citizen documents in NCT of Delhi.',
    helpline: 'Helpline: 1076 (Doorstep Service)',
    portalUrl: 'https://edistrict.delhigovt.nic.in',
    portalLabel: 'edistrict.delhigovt.nic.in',
  },
  {
    category: 'State & Citizen Services',
    jurisdiction: 'Maharashtra • State Citizen Services',
    name: 'Aaple Sarkar — Government of Maharashtra Portal',
    description: 'Official portal for Maharashtra state welfare schemes, revenue and caste certificates, and online citizen service tracking.',
    helpline: 'Toll-Free: 1800-120-8040',
    portalUrl: 'https://aaplesarkar.mahaonline.gov.in',
    portalLabel: 'aaplesarkar.mahaonline.gov.in',
  },
];

const CATEGORIES = [
  'All',
  'Central Scheme Portals',
  'Welfare & Pensions',
  'Education & Scholarships',
  'Health & Insurance',
  'Agriculture & Rural',
  'State & Citizen Services',
] as const;

export const LegalAidLocator: React.FC = () => {
  const { t } = useLanguage();
  const [selectedCategory, setSelectedCategoryState] = useState<string>(() => {
    return loadStorage<string>('govscheme_portals_category', 'All');
  });
  const setSelectedCategory = (val: string) => {
    setSelectedCategoryState(val);
    saveStorage('govscheme_portals_category', val);
  };

  const [searchQuery, setSearchQueryState] = useState<string>(() => {
    return loadStorage<string>('govscheme_portals_search', '');
  });
  const setSearchQuery = (val: string) => {
    setSearchQueryState(val);
    saveStorage('govscheme_portals_search', val);
  };

  const handleClearFilters = () => {
    setSelectedCategory('All');
    setSearchQuery('');
    clearFeatureStorage('govscheme_portals_');
  };

  const filteredPortals = SCHEME_PORTAL_DIRECTORY.filter((entry) => {
    const matchesCategory = selectedCategory === 'All' || entry.category === selectedCategory;
    const q = searchQuery.trim().toLowerCase();
    const matchesQuery =
      !q ||
      entry.name.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q) ||
      entry.jurisdiction.toLowerCase().includes(q) ||
      entry.category.toLowerCase().includes(q) ||
      entry.helpline.toLowerCase().includes(q) ||
      entry.portalLabel.toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header & High-Contrast Portal Hero Module */}
      <div className="bg-[#FBF8F1] border border-[#E7E1D3] rounded-2xl p-5 md:p-6 shadow-xs space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 md:gap-8">
          <div className="w-full md:w-[58%] space-y-4 text-left">
            <div className="flex items-center space-x-3 border-b border-[#E7E1D3] pb-3">
              <div className="w-9 h-9 rounded-lg bg-[#F6F1E7] text-[#B85C38] flex items-center justify-center border border-[#E7E1D3] shrink-0">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold font-heading text-[#1E1B17]">
                  {t('legal_aid.title')}
                </h2>
                <p className="text-xs text-[#6E6659] leading-relaxed">
                  {t('legal_aid.subtitle')}
                </p>
              </div>
            </div>

            {/* Highlighted National Scheme Portal & UMANG Citizen Helpdesk Card */}
            <div className="bg-[#17140F] p-4 sm:p-5 rounded-xl border border-[#17140F] text-[#FBF8F1] flex flex-wrap items-center justify-between gap-3.5 shadow-md">
              <div className="flex items-center space-x-3.5">
                <div className="w-11 h-11 rounded-full bg-[#D1FAE5]/20 text-[#6EE7B7] flex items-center justify-center border border-[#6EE7B7]/40 shrink-0">
                  <Globe className="w-5.5 h-5.5" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-[#6EE7B7] tracking-wider">
                    {t('legal_aid.helpline_tag')}
                  </div>
                  <div className="text-lg sm:text-xl font-bold font-mono text-white tracking-wide">
                    myscheme.gov.in • 1800-11-1555
                  </div>
                  <p className="text-[11px] text-slate-300">{t('legal_aid.helpline_sub')}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <a
                  href="tel:1800111555"
                  className="px-3.5 py-2 bg-[#6EE7B7] hover:bg-[#A7F3D0] text-[#065F46] font-bold text-xs rounded-lg shadow-sm flex items-center space-x-1.5 transition-colors"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>{t('legal_aid.call_now')}</span>
                </a>
                <a
                  href="https://www.myscheme.gov.in"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-2 bg-[#B85C38] hover:bg-[#9C4B2B] text-white font-bold text-xs rounded-lg shadow-sm flex items-center space-x-1.5 transition-colors"
                >
                  <span>Visit myScheme</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* Supporting Feature Pills */}
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <span className="text-[11px] font-medium text-[#1E1B17] bg-[#FBF8F1] px-2.5 py-1 rounded border border-[#E7E1D3] flex items-center space-x-1">
                <Shield className="w-3 h-3 text-[#B85C38]" />
                <span>{t('legal_aid.badge_rep')}</span>
              </span>
              <span className="text-[11px] font-medium text-[#1E1B17] bg-[#FBF8F1] px-2.5 py-1 rounded border border-[#E7E1D3] flex items-center space-x-1">
                <Clock className="w-3 h-3 text-[#065F46]" />
                <span>{t('legal_aid.badge_247')}</span>
              </span>
              <span className="text-[11px] font-medium text-[#1E1B17] bg-[#FBF8F1] px-2.5 py-1 rounded border border-[#E7E1D3] flex items-center space-x-1">
                <Globe className="w-3 h-3 text-[#B85C38]" />
                <span>{t('legal_aid.badge_coverage')}</span>
              </span>
            </div>
          </div>

          <div
            className="w-full md:w-[38%] justify-center items-center self-center hidden min-[380px]:flex relative min-h-[180px] sm:min-h-[220px] select-none pointer-events-none"
            onDragStart={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <img
              src="/assets/legal-aid-illustration.png"
              alt="Illustration of citizens accessing official government scheme portals and helpdesks"
              loading="eager"
              draggable="false"
              className="w-full h-auto max-w-xs sm:max-w-sm object-contain mx-auto select-none pointer-events-none"
            />
          </div>
        </div>

        {/* Search & Filter Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#6E6659] absolute left-3 top-2.5" />
            <input
              id="scheme-portal-search"
              name="schemePortalSearch"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('legal_aid.search_placeholder')}
              aria-label={t('legal_aid.search_placeholder')}
              className="w-full bg-[#F6F1E7] border border-[#E7E1D3] rounded-lg pl-8 pr-3.5 py-2 text-xs text-[#1E1B17] focus:outline-none focus:border-[#B85C38]"
            />
          </div>

          <select
            id="scheme-portal-category-select"
            name="schemePortalCategory"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            aria-label={t('legal_aid.all_states')}
            className="bg-[#F6F1E7] border border-[#E7E1D3] rounded-lg px-3 py-2 text-xs text-[#1E1B17] focus:outline-none focus:border-[#B85C38]"
          >
            <option value="All">{t('legal_aid.all_states')}</option>
            {CATEGORIES.filter((c) => c !== 'All').map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Scheme Portal & Helpdesk Cards */}
      {filteredPortals.length === 0 ? (
        <div className="bg-[#FBF8F1] border border-[#E7E1D3] rounded-2xl p-8 text-center space-y-3 shadow-xs">
          <div className="relative w-24 h-24 mx-auto">
            <img
              src="/assets/empty-state-illustration.png"
              alt="Illustration of a magnifying glass examining a circular"
              loading="eager"
              draggable="false"
              className="w-24 h-24 object-contain mx-auto select-none pointer-events-none"
            />
          </div>
          <div>
            <h3 className="text-xs font-bold text-[#1E1B17]">{t('legal_aid.no_offices_title')}</h3>
            <p className="text-xs text-[#6E6659] mt-1 max-w-sm mx-auto">
              {t('legal_aid.no_offices_sub', { query: searchQuery })}
            </p>
            <button
              type="button"
              onClick={handleClearFilters}
              className="mt-3 px-3.5 py-1.5 text-xs font-bold text-white bg-[#B85C38] hover:bg-[#9C4B2B] rounded-lg transition-colors cursor-pointer"
            >
              Reset Directory Filters
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredPortals.map((entry, idx) => (
            <div
              key={idx}
              className="bg-[#FBF8F1] border border-[#E7E1D3] hover:border-[#CBD5E1] rounded-2xl p-5 shadow-xs space-y-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 border-b border-[#E7E1D3] pb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#B85C38] bg-[#B85C38]/10 px-2.5 py-0.5 rounded border border-[#B85C38]/20">
                    {entry.category}
                  </span>
                  <Shield className="w-4 h-4 text-[#065F46] shrink-0" />
                </div>

                <div>
                  <h3 className="text-xs font-bold text-[#1E1B17] leading-snug">{entry.name}</h3>
                  <p className="text-[11px] font-semibold text-[#6E6659] mt-0.5">{entry.jurisdiction}</p>
                </div>

                <p className="text-xs text-[#6E6659] leading-relaxed font-sans">
                  {entry.description}
                </p>

                <p className="flex items-center space-x-1.5 text-xs text-[#B85C38] font-medium">
                  <Phone className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('legal_aid.helpline_label')}: {entry.helpline}</span>
                </p>
              </div>

              <div className="pt-2 border-t border-[#E7E1D3] flex items-center justify-between text-xs gap-2">
                <span className="text-[#6E6659] text-[11px]">{entry.portalLabel}</span>
                <a
                  href={entry.portalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#B85C38] hover:text-[#9C4B2B] font-semibold flex items-center space-x-1 text-[11px] shrink-0"
                >
                  <span>{t('legal_aid.visit_portal')}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Citizen Verification Info Box */}
      <div className="bg-[#FBF8F1] border border-[#E7E1D3] rounded-2xl p-4 text-xs text-[#1E1B17] space-y-1.5">
        <div className="flex items-center space-x-2 text-[#B85C38] font-bold">
          <Info className="w-3.5 h-3.5" />
          <span>{t('legal_aid.eligibility_title')}</span>
        </div>
        <p className="leading-relaxed text-[#6E6659]">
          {t('legal_aid.eligibility_desc')}
        </p>
      </div>
    </div>
  );
};
