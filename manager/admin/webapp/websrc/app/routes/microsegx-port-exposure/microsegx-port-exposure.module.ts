import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { NvCommonModule } from '@common/nvCommon.module';
import { MicrosegxPortExposureComponent } from './microsegx-port-exposure.component';
import { MicrosegxZitiSharedModule } from '../microsegx-ziti/microsegx-ziti-shared.module';

const routes: Routes = [
  {
    path: '',
    component: MicrosegxPortExposureComponent,
  },
];

@NgModule({
  declarations: [MicrosegxPortExposureComponent],
  imports: [
    RouterModule.forChild(routes),
    NvCommonModule,
    MicrosegxZitiSharedModule,
  ],
  exports: [MicrosegxPortExposureComponent],
})
export class MicrosegxPortExposureModule {}
