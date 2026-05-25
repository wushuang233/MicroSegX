import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { NvCommonModule } from '@common/nvCommon.module';
import { MicrosegxAutoPolicyComponent } from './microsegx-auto-policy.component';

const routes: Routes = [
  {
    path: '',
    component: MicrosegxAutoPolicyComponent,
  },
];

@NgModule({
  declarations: [MicrosegxAutoPolicyComponent],
  imports: [RouterModule.forChild(routes), NvCommonModule],
  exports: [MicrosegxAutoPolicyComponent],
})
export class MicrosegxAutoPolicyModule {}
