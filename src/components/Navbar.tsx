import React from 'react';
import {
  FileText,
  GitCompare,
  MapPin,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { ServerConfigStatus } from '../types/schemas';
import { useLanguage } from '../context/LanguageContext';

interface NavbarProps {
  readingLevel: 'simple' | 'very_simple';
  onToggleReadingLevel: (level: 'simple' | 'very_simple') => void;
  activeTab: 'analyze' | 'compare' | 'legal_aid';
  onSelectTab: (tab: 'analyze' | 'compare' | 'legal_aid') => void;
  onPrefetchTab?: (tab: 'compare' | 'legal_aid') => void;
  configStatus: ServerConfigStatus;
  onOpenSettings: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  onPrefetchTab,
  configStatus,
  onOpenSettings,
}) => {
  const { t } = useLanguage();

  return (
    <header className="sticky top-0 z-40 bg-[#FBF8F1]/95 backdrop-blur-xs border-b border-[#E7E1D3] px-2.5 sm:px-6 py-2 shadow-xs overflow-hidden">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-1 sm:gap-4 w-full min-h-[44px] sm:min-h-[48px]">
        {/* Left Zone: Brand Logo & Wordmark */}
        <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
          <img
            src="/assets/logo.png"
            alt="GovScheme Diff logo"
            width="40"
            height="40"
            draggable="false"
            onDragStart={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onDoubleClick={(e) => e.preventDefault()}
            className="w-7 h-7 sm:w-10 sm:h-10 object-contain rounded-full shrink-0 select-none pointer-events-none"
          />
          <div>
            <h1 className="text-[17px] sm:text-[19px] md:text-[20px] font-semibold font-brand text-[#2D261E] tracking-tight leading-none hidden sm:block">
              GovScheme <span className="text-[#B85C38] font-bold">Diff</span>
            </h1>
            <p className="text-[9px] text-[#6E6659] hidden md:block leading-none mt-0.5">
              {t('nav.brand_subtitle')}
            </p>
          </div>
        </div>

        {/* Center Zone: Cohesive Responsive Tab Group */}
        <div className="flex-1 flex justify-center items-center min-w-0 px-0.5 sm:px-1">
          <nav className="flex items-center bg-[#F6F1E7] p-1 rounded-xl border border-[#E7E1D3] shadow-2xs max-w-full overflow-x-auto no-scrollbar min-h-[36px] sm:min-h-[40px]">
            <button
              type="button"
              onClick={() => onSelectTab('analyze')}
              className={`flex items-center space-x-1 sm:space-x-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 shrink-0 cursor-pointer min-h-[28px] sm:min-h-[32px] ${
                activeTab === 'analyze'
                  ? 'bg-[#1E1B17] text-[#FBF8F1] font-bold shadow-xs'
                  : 'text-[#6E6659] hover:text-[#1E1B17] hover:bg-[#E7E1D3]/50'
              }`}
            >
              <FileText className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden lg:inline">{t('nav.tab_analyze')}</span>
              <span className="lg:hidden">{t('nav.tab_analyze_short')}</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('compare')}
              onMouseEnter={() => onPrefetchTab?.('compare')}
              onFocus={() => onPrefetchTab?.('compare')}
              className={`flex items-center space-x-1 sm:space-x-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 shrink-0 cursor-pointer min-h-[28px] sm:min-h-[32px] ${
                activeTab === 'compare'
                  ? 'bg-[#1E1B17] text-[#FBF8F1] font-bold shadow-xs'
                  : 'text-[#6E6659] hover:text-[#1E1B17] hover:bg-[#E7E1D3]/50'
              }`}
            >
              <GitCompare className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden lg:inline">{t('nav.tab_compare')}</span>
              <span className="lg:hidden">{t('nav.tab_compare_short')}</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('legal_aid')}
              onMouseEnter={() => onPrefetchTab?.('legal_aid')}
              onFocus={() => onPrefetchTab?.('legal_aid')}
              className={`flex items-center space-x-1 sm:space-x-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 shrink-0 cursor-pointer min-h-[28px] sm:min-h-[32px] ${
                activeTab === 'legal_aid'
                  ? 'bg-[#1E1B17] text-[#FBF8F1] font-bold shadow-xs'
                  : 'text-[#6E6659] hover:text-[#1E1B17] hover:bg-[#E7E1D3]/50'
              }`}
            >
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden lg:inline">{t('nav.tab_legal_aid')}</span>
              <span className="lg:hidden">{t('nav.tab_legal_aid_short')}</span>
            </button>
          </nav>
        </div>

        {/* Right Zone: Responsive Controls Cluster (Status Signal + Settings) */}
        <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
          {/* Subtle Global Trust Signal Badge with Reserved Dimensions */}
          <div className="hidden md:flex items-center justify-center min-w-[76px] h-[32px] shrink-0">
            {!configStatus.demoMode ? (
              <div
                className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-full bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0] text-[11px] font-semibold shrink-0 transition-opacity duration-200"
                title="Live AI Engine Active"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[#065F46] shrink-0" />
                <span>Live AI</span>
              </div>
            ) : (
              <div
                className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-full bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB] text-[11px] font-medium shrink-0 animate-pulse"
                title="Connecting to AI Service"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
                <span>Syncing</span>
              </div>
            )}
          </div>

          {/* Settings Button */}
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-1.5 sm:p-2 rounded-lg bg-[#F6F1E7] hover:bg-[#E7E1D3]/70 text-[#6E6659] hover:text-[#1E1B17] transition-colors duration-150 border border-[#E7E1D3] shrink-0"
            title="Settings"
          >
            <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
          </button>
        </div>
      </div>
    </header>
  );
};
