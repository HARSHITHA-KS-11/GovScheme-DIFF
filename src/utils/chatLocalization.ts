import { ChatMessage } from '../types/schemas';
import type { SupportedLanguage } from '../types/language';

const CANONICAL_MESSAGES: Record<string, string> = {
  welcome_default:
    '1. Hi! I explain government scheme circulars in simple everyday English.\n2. Upload or paste a circular to check eligibility, benefits, required documents, and deadlines.\n3. Every answer is grounded strictly in the circular text you provide.',
  capabilities_overview:
    '1. I explain government orders, scheme circulars, and guidelines in simple everyday English.\n2. I compare two circular versions to highlight changes in eligibility, money limits, benefits, documents, and deadlines.\n3. I answer questions using only the uploaded circular and clearly say if information is missing.',
  bot_identity:
    '1. I am GovScheme Diff AI, your plain-English guide for government scheme circulars.\n2. Upload or paste any circular to inspect eligibility, benefits, required papers, and closing dates.\n3. Visit the Scheme Portals & Helpdesks tab for official government websites and toll-free helplines.',
  error_generic: 'Sorry, I encountered an error processing your query. Please try again.',
  safety_refusal:
    'GovScheme Diff safety guardrail activated: We cannot assist with document forgery, fake scheme claims, bribery, or fraud. This service provides plain-language explanations of official public scheme circulars.',
};

export function localizeChatMessageText(text: string, _targetLang: SupportedLanguage = 'en'): string {
  if (!text) return text;
  const trimmed = text.trim();
  for (const key of Object.keys(CANONICAL_MESSAGES)) {
    if (trimmed === CANONICAL_MESSAGES[key]) {
      return CANONICAL_MESSAGES[key];
    }
  }
  return text;
}

export function localizeChatMessage(msg: ChatMessage, _targetLang: SupportedLanguage = 'en'): ChatMessage {
  if (msg.sender !== 'assistant') return msg;
  return {
    ...msg,
    text: localizeChatMessageText(msg.text, 'en'),
  };
}
