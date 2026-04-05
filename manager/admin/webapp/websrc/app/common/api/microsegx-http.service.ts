import { Injectable } from '@angular/core';
import { PathConstant } from '@common/constants/path.constant';
import { MicrosegxOverview } from '@common/types';
import { GlobalVariable } from '@common/variables/global.variable';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class MicrosegxHttpService {
  getOverview(): Observable<MicrosegxOverview> {
    return GlobalVariable.http.get<MicrosegxOverview>(
      PathConstant.MICROSEGX_OVERVIEW_URL
    );
  }
}
