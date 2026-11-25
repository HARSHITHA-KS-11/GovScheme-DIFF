
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Settings,
  X,
  Check,
  Volume2,
  VolumeX,
  Trash2,
  ShieldCheck,
} from 'lucide-react';
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  // Voice / Audio auto-read aloud preference
  const [autoSpeech, setAutoSpeech] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('legallens_auto_speech');
        if (saved !== null) return JSON.parse(saved);
      } catch {}
    }
    return true;
  });

  // Toast message state for feedback
  const [toastMsg, setToastMsg] = useState<string>('');

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleAutoSpeechToggle = (enabled: boolean) => {
    setAutoSpeech(enabled);
    try {
      localStorage.setItem('legallens_auto_speech', JSON.stringify(enabled));
    } catch {}
  };

  const handleClearCache = () => {
    try {
      localStorage.removeItem('legallens_chat_sessions');
      localStorage.removeItem('legallens_chat_history');

      setToastMsg('Local app cache cleared successfully!');

      setTimeout(() => setToastMsg(''), 2500);
    } catch {
      setToastMsg('Failed to clear cache');

      setTimeout(() => setToastMsg(''), 2500);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 w-full h-full z-50 flex items-center justify-center p-4 sm:p-6 bg-[#17140F]/65 backdrop-blur-md overflow-hidden animate-in fade-in duration-200">
      <div className="bg-[#FBF8F1] border border-[#E7E1D3] rounded-2xl p-5 sm:p-6 max-w-md w-full shadow-2xl relative space-y-5 my-auto max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-150">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E7E1D3] pb-3.5">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#B85C38]/10 text-[#B85C38] flex items-center justify-center border border-[#B85C38]/20">
              <Settings className="w-5 h-5" />
            </div>

            <div>
              <h2 className="text-base font-bold font-heading text-[#1E1B17]">
                Application Settings
              </h2>

              <p className="text-xs text-[#6E6659]">
                Customize your preferences
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-[#6E6659] hover:text-[#1E1B17] p-1.5 rounded-lg hover:bg-[#E7E1D3]/60 transition-colors cursor-pointer"
            title="Close Settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Voice Read-Aloud Preference */}
        <div className="space-y-2 pt-1 border-t border-[#E7E1D3]">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">

              {autoSpeech ? (
                <Volume2 className="w-4 h-4 text-[#B85C38]" />
              ) : (
                <VolumeX className="w-4 h-4 text-[#6E6659]" />
              )}

              <div>
                <div className="text-xs font-bold text-[#1E1B17]">
                  Auto Voice Output
                </div>

                <div className="text-[10px] text-[#6E6659]">
                  Speak AI responses automatically
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleAutoSpeechToggle(!autoSpeech)}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                autoSpeech ? 'bg-[#B85C38]' : 'bg-[#CBD5E1]'
              }`}
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  autoSpeech ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Data & Cache Maintenance */}
        <div className="pt-2 border-t border-[#E7E1D3] space-y-2">
          <div className="flex items-center justify-between bg-[#F6F1E7] p-3 rounded-xl border border-[#E7E1D3]">
            <div className="flex items-center space-x-2">
              <Trash2 className="w-4 h-4 text-[#6E6659]" />

              <div>
                <div className="text-xs font-bold text-[#1E1B17]">
                  Clear Chat Session Cache
                </div>

                <div className="text-[10px] text-[#6E6659]">
                  Reset saved offline chat history
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClearCache}
              className="px-2.5 py-1 bg-[#FBF8F1] hover:bg-[#E7E1D3] text-[#1E1B17] text-xs font-semibold rounded border border-[#E7E1D3] transition-colors cursor-pointer"
            >
              Clear
            </button>
          </div>

          {toastMsg && (
            <div className="flex items-center space-x-1.5 text-xs text-[#065F46] bg-[#D1FAE5] p-2 rounded-lg border border-[#6EE7B7]">
              <Check className="w-3.5 h-3.5" />
              <span>{toastMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-[#E7E1D3]">
          <div className="flex items-center space-x-1 text-[11px] text-[#6E6659]">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>GovScheme Diff v1.0</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-1.5 rounded-xl bg-[#B85C38] hover:bg-[#9C4B2B] text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            Done
          </button>
        </div>

      </div>
    </div>,
    document.body
  );
};

// Export ApiKeyModal alias for backwards compatibility
export const ApiKeyModal = SettingsModal;44
