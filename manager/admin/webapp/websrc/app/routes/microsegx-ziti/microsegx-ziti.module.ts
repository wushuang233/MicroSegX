import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { NvCommonModule } from '@common/nvCommon.module';
import { MicrosegxZitiComponent } from './microsegx-ziti.component';

const routes: Routes = [
  {
    path: '',
    component: MicrosegxZitiComponent,
  },
];

@NgModule({
  declarations: [MicrosegxZitiComponent],
  imports: [RouterModule.forChild(routes), NvCommonModule],
  exports: [MicrosegxZitiComponent],
})
export class MicrosegxZitiModule {}
