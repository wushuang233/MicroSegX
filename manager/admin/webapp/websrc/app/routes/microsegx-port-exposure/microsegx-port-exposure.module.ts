import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { NvCommonModule } from '@common/nvCommon.module';
import { MicrosegxPortExposureComponent } from './microsegx-port-exposure.component';

const routes: Routes = [
  {
    path: '',
    component: MicrosegxPortExposureComponent,
  },
];

@NgModule({
  declarations: [MicrosegxPortExposureComponent],
  imports: [RouterModule.forChild(routes), NvCommonModule],
  exports: [MicrosegxPortExposureComponent],
})
export class MicrosegxPortExposureModule {}
