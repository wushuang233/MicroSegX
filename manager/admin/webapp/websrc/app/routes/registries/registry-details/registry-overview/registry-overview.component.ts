import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { Image } from '@common/types';
import { ChartConfiguration } from 'chart.js';
import { TranslateService } from '@ngx-translate/core';

@Component({
  standalone: false,
  selector: 'app-registry-overview',
  templateUrl: './registry-overview.component.html',
  styleUrls: ['./registry-overview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegistryOverviewComponent implements OnChanges {
  @Input() registryDetails!: Image[];
  @Input() summary4AllView!: any;
  @Input() isAllView!: boolean;
  @Input() gridHeight!: number;
  pieChartData!: ChartConfiguration<'pie', number[], string[]>;
  barChartData!: ChartConfiguration<'bar', number[], string[]>;
  total!: number;
  finished!: number;
  percent!: number;
  noVulnerabilities!: boolean;
  pieChartColors = [
    'rgba(22, 119, 255, 0.92)',
    'rgba(62, 146, 255, 0.84)',
    'rgba(108, 177, 255, 0.78)',
    'rgba(158, 206, 255, 0.74)',
    'rgba(202, 227, 255, 0.7)',
    'rgba(216, 222, 230, 0.86)',
  ];
  barChartColors = {
    high: 'rgba(255, 77, 79, 0.84)',
    medium: 'rgba(22, 119, 255, 0.78)',
  };

  static sortByVulnerabilities(a: Image, b: Image): number {
    if (a.high + a.medium === b.high + b.medium) {
      return 0;
    }
    return a.high + a.medium > b.high + b.medium ? -1 : 1;
  }

  constructor(private translate: TranslateService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.isAllView && changes.registryDetails) {
      this.total = changes.registryDetails.currentValue.length;
      this.finished = changes.registryDetails.currentValue.filter(
        ({ status }) => status === 'finished'
      ).length;
      this.percent = Math.floor((this.finished / this.total) * 100);
      const sortedRegistryDetails = changes.registryDetails.currentValue
        .slice()
        .sort(RegistryOverviewComponent.sortByVulnerabilities);
      const topFive = sortedRegistryDetails.slice(0, 5).map(image => {
        return {
          repository: image.repository,
          tag: image.tag,
          vulnerabilities: { high: image.high, medium: image.medium },
        };
      });
      const otherVulnerabilities = sortedRegistryDetails
        .slice(5, sortedRegistryDetails.length)
        .reduce((sum, { high, medium }) => sum + high + medium, 0);
      const topSix = [
        ...topFive.map(i => {
          return {
            repository: i.repository,
            tag: i.tag,
            vulnerabilities: i.vulnerabilities.high + i.vulnerabilities.medium,
          };
        }),
        {
          repository: this.translate.instant(
            'dashboard.body.panel_title.OTHERS'
          ),
          vulnerabilities: otherVulnerabilities,
        },
      ];
      console.log('topSix', topSix);
      this.noVulnerabilities = topSix.every(vul => !vul.vulnerabilities);
      this.pieChartData = this.getPieChartOptions(topSix);
      this.barChartData = this.getBarChartOptions(topFive);
    }
    if (this.isAllView && changes.summary4AllView) {
      const topImages =
        changes.summary4AllView.currentValue.allScannedImagesSummary.summary
          .top_images;
      const topSix = topImages.map(i => {
        return {
          repository: i.display_name,
          vulnerabilities: i.high + i.medium,
        };
      });

      const topFive = topImages.slice(0, 5).map(i => {
        return {
          repository: i.display_name,
          vulnerabilities: {
            high: i.high,
            medium: i.medium,
          },
        };
      });
      console.log('topSix', topSix);
      this.noVulnerabilities = topSix.every(vul => !vul.vulnerabilities);
      this.pieChartData = this.getPieChartOptions(topSix);
      this.barChartData = this.getBarChartOptions(topFive);
    }
  }

  private getBarChartOptions(
    topFive
  ): ChartConfiguration<'bar', number[], string[]> {
    return {
      options: {
        indexAxis: 'y',
        scales: {
          x: {
            ticks: {
              callback: (value: any) => {
                if (value % 1 === 0) {
                  return value;
                }
              },
            },
            beginAtZero: true,
            grid: {
              color: 'rgba(15, 23, 42, 0.06)',
            },
          },
        },
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: false,
            text: this.translate.instant('registry.TOP_RISKIEST_IMG'),
          },
          legend: {
            display: true,
            position: 'top',
          },
        },
      },
      data: {
        labels: topFive.map(item => {
          return [item.repository];
        }),
        datasets: [
          {
            data: topFive.map(i => i.vulnerabilities.high),
            label: this.translate.instant('enum.HIGH'),
            backgroundColor: this.barChartColors.high,
            barThickness: 10,
            borderRadius: 8,
            borderWidth: 0,
          },
          {
            data: topFive.map(i => i.vulnerabilities.medium),
            label: this.translate.instant('enum.MEDIUM'),
            backgroundColor: this.barChartColors.medium,
            barThickness: 10,
            borderRadius: 8,
            borderWidth: 0,
          },
        ],
      },
      type: 'bar',
    };
  }

  private getPieChartOptions(
    topSix
  ): ChartConfiguration<'pie', number[], string[]> {
    return {
      options: {
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: false,
            text: this.translate.instant('registry.TOP_RISKIEST_IMG'),
          },
          legend: {
            display: true,
            position: 'right',
          },
        },
      },
      data: {
        labels: topSix.map(item => {
          return [item.repository];
        }),
        datasets: [
          {
            hoverBorderColor: this.pieChartColors,
            hoverBackgroundColor: this.pieChartColors,
            backgroundColor: this.pieChartColors,
            data: topSix.map(item => item.vulnerabilities),
          },
        ],
      },
      type: 'pie',
    };
  }
}
