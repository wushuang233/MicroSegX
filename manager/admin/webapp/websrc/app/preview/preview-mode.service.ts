import { Inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { LOCAL_STORAGE, StorageService } from 'ngx-webstorage-service';
import { environment } from '../../environments/environment';
import { GlobalConstant } from '@common/constants/global.constant';
import { GlobalVariable } from '@common/variables/global.variable';
import { TranslateService } from '@ngx-translate/core';
import { PREVIEW_SUMMARY_RESPONSE, PREVIEW_USER } from './preview-data';

@Injectable({ providedIn: 'root' })
export class PreviewModeService {
  constructor(
    private router: Router,
    private translateService: TranslateService,
    @Inject(LOCAL_STORAGE) private localStorage: StorageService
  ) {}

  get enabled(): boolean {
    return environment.previewMode;
  }

  enterPreview(): void {
    if (!this.enabled) {
      return;
    }

    const locale = this.translateService.currentLang || 'en';
    const previewUser = JSON.parse(JSON.stringify(PREVIEW_USER));
    previewUser.token.locale = locale;

    GlobalVariable.user = previewUser;
    GlobalVariable.nvToken = previewUser.token.token;
    GlobalVariable.isSUSESSO = false;
    GlobalVariable.summary = JSON.parse(
      JSON.stringify(PREVIEW_SUMMARY_RESPONSE.summary)
    );
    GlobalVariable.hasInitializedSummary = true;
    GlobalVariable.isOpenShift = false;
    GlobalVariable.isMaster = false;
    GlobalVariable.isMember = false;
    GlobalVariable.isStandAlone = true;
    GlobalVariable.isRemote = false;
    GlobalVariable.gravatar = false;

    this.localStorage.set(GlobalConstant.LOCAL_STORAGE_TOKEN, previewUser);
    if (this.localStorage.has(GlobalConstant.LOCAL_STORAGE_TIMEOUT)) {
      this.localStorage.remove(GlobalConstant.LOCAL_STORAGE_TIMEOUT);
    }

    this.router.navigate([GlobalConstant.PATH_DEFAULT]);
  }
}
