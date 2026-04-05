import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

@Injectable()
export class SwitchersService {
  private user: any;
  private readonly app: any;
  private readonly layout: any;

  constructor(private translateService: TranslateService) {
    this.app = {
      name: '',
      description: '',
      year: new Date().getFullYear(),
    };
    this.syncAppMetadata();
    this.translateService.onLangChange.subscribe(() => {
      this.syncAppMetadata();
    });

    this.layout = {
      isFixed: true,
      isCollapsed: false,
      isBoxed: false,
      isRTL: false,
      horizontal: false,
      isFloat: false,
      leftSideHover: false,
      theme: null,
      leftSideScrollbar: false,
      isCollapsedText: false,
      useFullLayout: false,
      hiddenFooter: false,
      offsidebarOpen: false,
      leftSideToggled: false,
      viewAnimation: 'ng-fadeInUp',
    };
  }

  getAppSwitcher(name) {
    return name ? this.app[name] : this.app;
  }

  setAppSwitcher(name, value) {
    if (typeof this.app[name] !== 'undefined') {
      this.app[name] = value;
    }
  }

  setFrameSwitcher(name, value) {
    if (typeof this.layout[name] !== 'undefined') {
      return (this.layout[name] = value);
    }
  }

  getFrameSwitcher(name) {
    return name ? this.layout[name] : this.layout;
  }

  toggleFrameSwitcher(name) {
    return this.setFrameSwitcher(name, !this.getFrameSwitcher(name));
  }

  private syncAppMetadata(): void {
    const activeLanguage =
      this.translateService.currentLang ||
      this.translateService.getFallbackLang() ||
      'en';
    const isChinese = activeLanguage === 'zh_cn';
    this.app.name = isChinese
      ? '面向多云环境的主动微隔离系统'
      : 'Active Microsegmentation System for Multi-cloud Environments';
    this.app.description = isChinese
      ? '多云安全与主动微隔离控制台'
      : 'Multi-cloud security and active microsegmentation workspace';
  }
}
