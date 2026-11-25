import React, { useEffect, useState } from 'react';
import {
  History,
  FileText,
  GitBranch,
  GitCompare,
  RefreshCw,
  FolderOpen,
  FilePlus2,
  Loader2,
  AlertCircle,
  Layers,
} from 'lucide-react';
import { ApiClient } from '../services/apiClient';
import {
  SavedCircularSummary,
  SavedCircularVersionDetail,
  SavedCircularVersionSummary,
} from '../types/schemas';

interface CircularHistoryPanelProps {
  refreshToken?: number;
  activeVersionId?: string | null;
  selectedParentCircularId?: string | null;
  onSelectParentCircular?: (circular: { id: string; title: string } | null) => void;
  onOpenVersion: (version: SavedCircularVersionDetail) => void;
  onCompareVersions?: (
    versionA: SavedCircularVersionDetail,
    versionB: SavedCircularVersionDetail
  ) => void;
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export const CircularHistoryPanel: React.FC<CircularHistoryPanelProps> = ({
  refreshToken = 0,
  activeVersionId,
  selectedParentCircularId,
  onSelectParentCircular,
  onOpenVersion,
  onCompareVersions,
}) => {
  const [circulars, setCirculars] = useState<SavedCircularSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadHistory = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const rows = await ApiClient.listCirculars(25);
      setCirculars(rows);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Saved circular history is temporarily unavailable.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [refreshToken]);

  const handleOpenVersionClick = async (version: SavedCircularVersionSummary) => {
    setOpeningId(version.id);
    setErrorMsg(null);
    try {
      const detail = await ApiClient.getCircularVersion(version.id);
      onOpenVersion(detail);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not reopen this saved circular.');
    } finally {
      setOpeningId(null);
    }
  };

  const handleCompareOriginalAndLatest = async (circular: SavedCircularSummary) => {
    if (!onCompareVersions || circular.versions.length < 2) return;
    const first = circular.versions[0];
    const latest = circular.versions[circular.versions.length - 1];
    setOpeningId(`cmp_${circular.id}`);
    setErrorMsg(null);
    try {
      const [detailA, detailB] = await Promise.all([
        ApiClient.getCircularVersion(first.id),
        ApiClient.getCircularVersion(latest.id),
      ]);
      onCompareVersions(detailA, detailB);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not load original and amended versions to compare.');
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div className="bg-[#FBF8F1] border border-[#E7E1D3] rounded-2xl p-5 md:p-6 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E7E1D3] pb-3">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-[#F6F1E7] text-[#B85C38] flex items-center justify-center border border-[#E7E1D3] shrink-0">
            <History className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold font-heading text-[#1E1B17]">
              Saved Circulars & Amendment History
            </h3>
            <p className="text-xs text-[#6E6659]">
              Reopen past government circulars, track amendment versions, or compare original vs revised rules.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadHistory}
          disabled={isLoading}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#F6F1E7] hover:bg-[#E7E1D3]/60 text-[#1E1B17] text-xs font-semibold rounded-lg border border-[#E7E1D3] transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#B85C38] ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {selectedParentCircularId && (
        <div className="bg-[#FFF8F0] border border-[#FDE68A] rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#92400E]">
          <div className="flex items-center space-x-2">
            <GitBranch className="w-4 h-4 text-[#B85C38] shrink-0" />
            <span>
              Next circular you analyze will be saved as an <strong>amendment</strong> under the selected original circular.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onSelectParentCircular?.(null)}
            className="text-xs font-bold underline text-[#991B1B] cursor-pointer"
          >
            Cancel Link
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-[#FFF5F5] border border-[#FCA5A5] rounded-xl text-xs text-[#991B1B] flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {isLoading ? (
        <div className="py-6 flex items-center justify-center space-x-2 text-xs text-[#6E6659]">
          <Loader2 className="w-4 h-4 animate-spin text-[#B85C38]" />
          <span>Loading saved circular history...</span>
        </div>
      ) : circulars.length === 0 ? (
        <div className="p-5 bg-[#F6F1E7] border border-[#E7E1D3] rounded-xl text-center text-xs text-[#6E6659] space-y-1">
          <p className="font-semibold text-[#1E1B17]">No saved circulars yet.</p>
          <p>Analyze any uploaded PDF, image, or pasted circular above to save it to your permanent history.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {circulars.map((circular) => {
            const isSelectedParent = selectedParentCircularId === circular.id;
            const hasMultipleVersions = circular.versions.length >= 2;

            return (
              <div
                key={circular.id}
                className={`p-4 rounded-xl border transition-all space-y-3 bg-[#F6F1E7] ${
                  isSelectedParent
                    ? 'border-[#B85C38] ring-2 ring-[#B85C38]/20'
                    : 'border-[#E7E1D3]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-[#B85C38]/10 text-[#B85C38] border border-[#B85C38]/20">
                        {circular.category}
                      </span>
                      {circular.circularNumber && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[#FBF8F1] text-[#1E1B17] border border-[#E7E1D3]">
                          {circular.circularNumber}
                        </span>
                      )}
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#D1FAE5] text-[#065F46] border border-[#6EE7B7]">
                        {circular.totalVersions} {circular.totalVersions === 1 ? 'Version' : 'Versions'}
                      </span>
                    </div>

                    <h4 className="text-xs sm:text-sm font-bold text-[#1E1B17] leading-snug break-words">
                      {circular.title}
                    </h4>
                    {circular.issuingAuthority && (
                      <p className="text-[11px] text-[#6E6659] truncate mt-0.5">{circular.issuingAuthority}</p>
                    )}
                  </div>
                </div>

                {/* Ordered Versions & Amendments */}
                <div className="space-y-2">
                  {circular.versions.map((ver) => {
                    const isActive = activeVersionId === ver.id;
                    const isBusy = openingId === ver.id;
                    return (
                      <div
                        key={ver.id}
                        className={`p-2.5 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
                          isActive
                            ? 'bg-[#FFF8F0] border-[#B85C38]'
                            : 'bg-[#FBF8F1] border-[#E7E1D3]'
                        }`}
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                                ver.isAmendment
                                  ? 'bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]'
                                  : 'bg-[#E7E1D3] text-[#1E1B17]'
                              }`}
                            >
                              {ver.isAmendment ? `v${ver.versionNumber} Amendment` : `v${ver.versionNumber} Original`}
                            </span>
                            <span className="text-[10px] text-[#6E6659] font-mono">
                              {ver.pageCount} {ver.pageCount === 1 ? 'page' : 'pages'} • {ver.sectionCount} sections
                            </span>
                          </div>
                          <div className="text-[11px] text-[#6E6659] flex flex-wrap items-center gap-1.5">
                            <FileText className="w-3 h-3 text-[#B85C38] shrink-0" />
                            <span className="truncate max-w-[200px]">
                              {ver.sourceFilename || `${ver.sourceType} input`}
                            </span>
                            <span>• {formatShortDate(ver.createdAt)}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleOpenVersionClick(ver)}
                          className="px-2.5 py-1 bg-[#1E1B17] hover:bg-[#B85C38] text-[#FBF8F1] text-[11px] font-bold rounded-md transition-colors flex items-center space-x-1 cursor-pointer shrink-0 disabled:opacity-50"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <FolderOpen className="w-3 h-3" />
                          )}
                          <span>{isActive ? 'Opened' : 'Reopen'}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Circular Group Actions */}
                <div className="pt-2 border-t border-[#E7E1D3] flex flex-wrap items-center justify-between gap-2">
                  {onSelectParentCircular && (
                    <button
                      type="button"
                      onClick={() =>
                        onSelectParentCircular(
                          isSelectedParent ? null : { id: circular.id, title: circular.title }
                        )
                      }
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded border flex items-center space-x-1 transition-colors cursor-pointer ${
                        isSelectedParent
                          ? 'bg-[#B85C38] text-white border-[#B85C38]'
                          : 'bg-[#FBF8F1] hover:bg-[#E7E1D3]/60 text-[#1E1B17] border-[#E7E1D3]'
                      }`}
                    >
                      <FilePlus2 className="w-3 h-3" />
                      <span>{isSelectedParent ? 'Selected for Amendment' : 'Add Amendment'}</span>
                    </button>
                  )}

                  {hasMultipleVersions && onCompareVersions && (
                    <button
                      type="button"
                      disabled={openingId === `cmp_${circular.id}`}
                      onClick={() => handleCompareOriginalAndLatest(circular)}
                      className="text-[11px] font-bold px-2.5 py-1 rounded bg-[#B85C38] hover:bg-[#9C4B2B] text-white flex items-center space-x-1 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {openingId === `cmp_${circular.id}` ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <GitCompare className="w-3 h-3" />
                      )}
                      <span>
                        <Layers className="w-3 h-3 inline mr-1" />
                        Compare v1 vs v{circular.versions[circular.versions.length - 1].versionNumber}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
