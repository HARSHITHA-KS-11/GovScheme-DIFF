import React, { createContext, useContext, useState, ReactNode } from 'react';
import enTranslations from '../locales/en.json';
import type { SupportedLanguage } from '../types/language';

export type { SupportedLanguage } from '../types/language';

interface LanguageContextType {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const STORAGE_LANG_KEY = 'govscheme_language';

const translations: Record<SupportedLanguage, any> = {
  en: enTranslations,
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<SupportedLanguage>(() => {
    try {
      localStorage.setItem(STORAGE_LANG_KEY, 'en');
    } catch {}
    return 'en';
  });

  const setLanguage = (_lang: SupportedLanguage) => {
    setLanguageState('en');
    try {
      localStorage.setItem(STORAGE_LANG_KEY, 'en');
    } catch {}
  };

  const t = (keyPath: string, params?: Record<string, string | number>): string => {
    const keys = keyPath.split('.');
    let current: any = translations[language];
    let fallback: any = translations['en'];

    for (const key of keys) {
      current = current && typeof current === 'object' && key in current ? current[key] : undefined;
      fallback = fallback && typeof fallback === 'object' && key in fallback ? fallback[key] : undefined;
    }

    let result = typeof current === 'string' ? current : typeof fallback === 'string' ? fallback : keyPath;

    if (params) {
      Object.entries(params).forEach(([pKey, pVal]) => {
        result = result.replace(new RegExp(`{{\\s*${pKey}\\s*}}`, 'g'), String(pVal));
      });
    }

    return result;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
