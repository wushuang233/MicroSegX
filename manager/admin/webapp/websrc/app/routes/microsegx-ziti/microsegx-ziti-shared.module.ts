import { NgModule } from '@angular/core';
import { NvCommonModule } from '@common/nvCommon.module';
import { MicrosegxZitiComponent } from './microsegx-ziti.component';

@NgModule({
  declarations: [MicrosegxZitiComponent],
  imports: [NvCommonModule],
  exports: [MicrosegxZitiComponent],
})
export class MicrosegxZitiSharedModule {}
