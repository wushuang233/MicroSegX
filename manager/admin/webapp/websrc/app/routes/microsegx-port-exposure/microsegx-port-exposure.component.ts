import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MicrosegxHttpService } from '@common/api/microsegx-http.service';
import { MicrosegxOverview } from '@common/types';

@Component({
  standalone: false,
  selector: 'app-microsegx-port-exposure',
  templateUrl: './microsegx-port-exposure.component.html',
  styleUrls: ['./microsegx-port-exposure.component.scss'],
})
export class MicrosegxPortExposureComponent implements OnInit {
  overview: MicrosegxOverview | null = null;
  loading = false;
  error = '';
  workspaceUrl: SafeResourceUrl;

  constructor(
    private microsegxHttpService: MicrosegxHttpService,
    private sanitizer: DomSanitizer
  ) {
    this.workspaceUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
      '/microsegx/ui/port-exposure/'
    );
  }

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.error = '';
    this.loading = true;
    this.microsegxHttpService.getOverview().subscribe({
      next: overview => {
        this.overview = overview;
        this.loading = false;
      },
      error: err => {
        this.error = err?.error?.message || err?.message || '加载失败';
        this.loading = false;
      },
    });
  }
}
