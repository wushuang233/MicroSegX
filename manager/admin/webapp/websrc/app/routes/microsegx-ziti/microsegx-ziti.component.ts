import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MicrosegxHttpService } from '@common/api/microsegx-http.service';
import { MicrosegxOverview } from '@common/types';

@Component({
  standalone: false,
  selector: 'app-microsegx-ziti',
  templateUrl: './microsegx-ziti.component.html',
  styleUrls: ['./microsegx-ziti.component.scss'],
})
export class MicrosegxZitiComponent implements OnInit {
  overview: MicrosegxOverview | null = null;
  loading = false;
  error = '';
  workspaceUrl: SafeResourceUrl;

  constructor(
    private microsegxHttpService: MicrosegxHttpService,
    private sanitizer: DomSanitizer
  ) {
    this.workspaceUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
      '/microsegx/ui/ziti/'
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
