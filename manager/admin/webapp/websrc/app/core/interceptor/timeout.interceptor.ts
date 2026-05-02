import { Inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Location } from '@angular/common';
import { tap, timeout } from 'rxjs/operators';
import { Router } from '@angular/router';
import { GlobalConstant } from '@common/constants/global.constant';
import { PathConstant } from '@common/constants/path.constant';
import { AuthService } from '@common/services/auth.service';
import {
  LOCAL_STORAGE,
  SESSION_STORAGE,
  StorageService,
} from 'ngx-webstorage-service';
import { GlobalVariable } from '@common/variables/global.variable';

@Injectable()
export class TimeoutInterceptor implements HttpInterceptor {
  private readonly nonBlockingAuthFailureUrls = [
    PathConstant.DASHBOARD_SUMMARY_URL,
    PathConstant.DASHBOARD_DETAILS_URL,
    PathConstant.DASHBOARD_NOTIFICATIONS_URL,
    PathConstant.MULTI_CLUSTER_SUMMARY,
    PathConstant.FED_MEMBER_URL,
    PathConstant.FED_SUMMARY,
    PathConstant.MICROSEGX_OVERVIEW_URL,
  ];

  constructor(
    private router: Router,
    private location: Location,
    private auth: AuthService,
    private dialog: MatDialog,
    @Inject(LOCAL_STORAGE) private localStorage: StorageService,
    @Inject(SESSION_STORAGE) private sessionStorage: StorageService
  ) {
    this.location = location;
  }

  private requestTimeoutMs(req: HttpRequest<any>): number {
    if (req.url.includes(PathConstant.MICROSEGX_OVERVIEW_URL)) {
      return 15000;
    }

    if (req.url.includes('policy/auto/')) {
      return 15000;
    }

    if (req.url.includes('/microsegx/api/')) {
      return 20000;
    }

    if (req.method === 'GET') {
      return 60000;
    }

    return 120000;
  }

  private isNonBlockingAuthFailure(
    req: HttpRequest<any>,
    status: number
  ): boolean {
    if (
      req.url === PathConstant.TOKEN_AUTH ||
      req.url === PathConstant.SELF_URL
    ) {
      return false;
    }

    if (
      status !== GlobalConstant.STATUS_AUTH_TIMEOUT &&
      status !== GlobalConstant.STATUS_UNAUTH &&
      status !== GlobalConstant.STATUS_SERVER_UNAVAILABLE
    ) {
      return false;
    }

    return this.nonBlockingAuthFailureUrls.some(url => req.url.includes(url));
  }

  intercept(req: HttpRequest<any>, next: HttpHandler) {
    // console.log('Timeout intecepting...');

    return next.handle(req).pipe(
      timeout(this.requestTimeoutMs(req)),
      tap(
        event => {
          // console.log('normal:', event);
        },
        error => {
          let status: number = error.status;
          let currentPath: string = this.location.path();
          if (this.isNonBlockingAuthFailure(req, status)) {
            return;
          }
          console.error(error, this.location.path());
          if (
            status === GlobalConstant.STATUS_UNAUTH ||
            status === GlobalConstant.STATUS_AUTH_TIMEOUT ||
            (status === GlobalConstant.STATUS_SERVER_UNAVAILABLE &&
              currentPath !== GlobalConstant.PATH_LOGIN &&
              currentPath !== '/' + GlobalConstant.PATH_LOGIN &&
              currentPath !== GlobalConstant.PATH_MULTICLUSTER &&
              !req.url.endsWith(PathConstant.MULTI_CLUSTER_SUMMARY)) ||
            //For Rancher SSO from downstream cluster
            (status === GlobalConstant.STATUS_FORBIDDEN &&
              error.error?.Message?.includes(
                GlobalConstant.RANCHER_AUTH_FAIL_MSG
              )) ||
            req.url === PathConstant.TOKEN_AUTH ||
            req.url === PathConstant.SELF_URL
          ) {
            this.localStorage.set(
              GlobalConstant.LOCAL_STORAGE_ORIGINAL_URL,
              currentPath
            );
            this.dialog.closeAll();
            // For SSO, we need to clear the local storage token and redirect to the logout page
            if (GlobalVariable.isSUSESSO) {
              this.localStorage.remove(GlobalConstant.LOCAL_STORAGE_TOKEN);
              this.router.navigate([GlobalConstant.PATH_LOGOUT]);
            } else {
              this.localStorage.set(GlobalConstant.LOCAL_STORAGE_TIMEOUT, true);
              this.auth.timeout(currentPath);
            }
          }
        }
      )
    );
  }
}
