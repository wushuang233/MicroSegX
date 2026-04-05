import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FederatedPolicyConfigurationComponent } from './federated-policy-configuration.component';
import { LoadingButtonModule } from '@components/ui/loading-button/loading-button.module';
import { LoadingTemplateModule } from '@components/ui/loading-template/loading-template.module';
import { FederatedConfigFormComponent } from './federated-config-form/federated-config-form.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MicroSegXFormlyModule } from '@common/microsegx-formly/microsegx-formly.module';
import { FederatedConfigurationService } from '@services/federated-configuration.service';
import { MatCardModule } from '@angular/material/card';
import { ImportFileModule } from '@components/ui/import-file/import-file.module';
import { ExportFormModule } from '@routes/settings/configuration/export-form/export-form.module';

@NgModule({
  declarations: [
    FederatedPolicyConfigurationComponent,
    FederatedConfigFormComponent,
  ],
  exports: [FederatedPolicyConfigurationComponent],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    FormsModule,
    LoadingButtonModule,
    LoadingTemplateModule,
    MicroSegXFormlyModule,
    MatCardModule,
    ImportFileModule,
    ExportFormModule,
  ],
  providers: [FederatedConfigurationService],
})
export class FederatedPolicyConfigurationModule {}
