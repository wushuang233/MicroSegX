import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MicroSegXFormlyModule } from '@common/microsegx-formly/microsegx-formly.module';
import { ObserveModule } from '@common/directives/observe/observe.module';
import { ExportFormComponent } from './export-form.component';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ImportFileModule } from '@components/ui/import-file/import-file.module';
import { NvCommonModule } from '@common/nvCommon.module';
import { LoadingButtonModule } from '@components/ui/loading-button/loading-button.module';
import { LoadingTemplateModule } from '@components/ui/loading-template/loading-template.module';
import { ExportOptionsModule } from '@components/export-options/export-options.module';

@NgModule({
  declarations: [ExportFormComponent],
  imports: [
    CommonModule,
    NvCommonModule,
    ReactiveFormsModule,
    FormsModule,
    TranslateModule,
    MicroSegXFormlyModule,
    ImportFileModule,
    ObserveModule,
    MatCheckboxModule,
    LoadingButtonModule,
    LoadingTemplateModule,
    ExportOptionsModule,
  ],
  exports: [ExportFormComponent],
})
export class ExportFormModule {}
