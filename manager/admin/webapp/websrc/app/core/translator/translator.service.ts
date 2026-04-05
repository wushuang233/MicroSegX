import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

const LOCALE_STORAGE_KEY = 'nv-ui-locale';

@Injectable({
  providedIn: 'root',
})
export class TranslatorService {
  private readonly defaultLanguage = 'en';

  private readonly availablelangs = [
    { code: 'en', text: 'English' },
    { code: 'zh_cn', text: '中文' },
  ];

  constructor(public translate: TranslateService) {
    this.translate.addLangs(this.availablelangs.map(lang => lang.code));
    this.translate.setFallbackLang(this.defaultLanguage);
    this.translate.use(this.resolveLanguage());
  }

  useLanguage(lang: string = '') {
    const fallback = this.translate.getFallbackLang() ?? this.defaultLanguage;
    const language = this.isSupported(lang) ? lang : fallback;
    this.translate.use(language);
    this.persistLanguage(language);
  }

  getAvailableLanguages() {
    return this.availablelangs;
  }

  private resolveLanguage(): string {
    const persisted =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(LOCALE_STORAGE_KEY)
        : '';
    if (this.isSupported(persisted)) {
      return persisted as string;
    }

    const browserLang =
      typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : '';
    if (browserLang.startsWith('zh')) {
      return 'zh_cn';
    }

    return this.defaultLanguage;
  }

  private isSupported(lang: string | null | undefined): boolean {
    return !!lang && this.availablelangs.some(item => item.code === lang);
  }

  private persistLanguage(lang: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(LOCALE_STORAGE_KEY, lang);
  }
}
