import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

const LOCALE_STORAGE_KEY = 'nv-ui-locale';

@Injectable({
  providedIn: 'root',
})
export class TranslatorService {
  private readonly defaultLanguage = 'zh_cn';

  private readonly availablelangs = [{ code: 'zh_cn', text: '中文' }];

  constructor(public translate: TranslateService) {
    this.translate.addLangs(this.availablelangs.map(lang => lang.code));
    this.translate.setFallbackLang(this.defaultLanguage);
    this.initializeLanguage();
  }

  useLanguage(lang: string = '') {
    const fallback = this.translate.getFallbackLang() ?? this.defaultLanguage;
    const language = this.isSupported(lang) ? lang : fallback;
    this.translate.use(language);
    this.persistLanguage(language);
  }

  initializeLanguage(preferredLang: string = ''): string {
    const language = this.resolveLanguage(preferredLang);
    this.translate.use(language);
    this.persistLanguage(language);
    return language;
  }

  getAvailableLanguages() {
    return this.availablelangs;
  }

  private resolveLanguage(preferredLang: string = ''): string {
    const persisted =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(LOCALE_STORAGE_KEY)
        : '';
    if (this.isSupported(persisted)) {
      return persisted as string;
    }

    if (this.isSupported(preferredLang)) {
      return preferredLang;
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
