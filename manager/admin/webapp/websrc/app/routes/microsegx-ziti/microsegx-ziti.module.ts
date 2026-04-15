import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { MicrosegxZitiComponent } from './microsegx-ziti.component';
import { MicrosegxZitiSharedModule } from './microsegx-ziti-shared.module';

const routes: Routes = [
  {
    path: '',
    component: MicrosegxZitiComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes), MicrosegxZitiSharedModule],
})
export class MicrosegxZitiModule {}
