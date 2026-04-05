import { Component, OnInit, Input } from '@angular/core';
import {
  groupBy,
  parseLocalDate,
  getDuration,
} from '@common/utils/common.utils';
import { UtilsService } from '@common/utils/app.utils';

@Component({
  standalone: false,
  selector: 'app-security-event-chart',
  templateUrl: './security-event-chart.component.html',
  styleUrls: ['./security-event-chart.component.scss'],
})
export class SecurityEventChartComponent implements OnInit {
  @Input() secEventList: Array<any>;
  securityEventsLineChartConfig: any;

  constructor(private utils: UtilsService) {}

  ngOnInit(): void {
    this.drawSecurityEventsLineChart(this.secEventList);
  }

  drawSecurityEventsLineChart = (securityEventList: Array<any>) => {
    let securityEventsLineChartData: Array<any> = [];
    let secEventByReportDate = groupBy(securityEventList, 'reportedOn');
    let earliestDateStr = parseLocalDate(
      securityEventList[securityEventList.length - 1].orgReportedAt
    );
    let nowDateObj = new Date();
    let nowDateStr = this.utils.parseDatetimeStr(nowDateObj)!.substring(0, 8);
    let date = earliestDateStr;
    let startDate = date;
    let maxTimeGap = getDuration(nowDateStr, earliestDateStr);
    for (
      ;
      date <= nowDateStr;
      date = this.utils.getDateByInterval(date, 1, 'days')!.substring(0, 8)
    ) {
      securityEventsLineChartData.push(
        secEventByReportDate.hasOwnProperty(date)
          ? secEventByReportDate[date].length
          : 0
      );
    }
    if (maxTimeGap === 0) {
      securityEventsLineChartData.push(
        secEventByReportDate.hasOwnProperty(startDate)
          ? secEventByReportDate[startDate].length
          : 0
      );
    }
    console.log('securityEventsLineChartData', securityEventsLineChartData);
    this.securityEventsLineChartConfig = {
      type: 'line',
      data: {
        labels: new Array(securityEventsLineChartData.length).fill(''),
        datasets: [
          {
            data: securityEventsLineChartData,
            pointRadius: 0,
            backgroundColor: 'rgba(22, 119, 255, 0.14)',
            borderColor: '#1677ff',
            hoverBackgroundColor: 'rgba(22, 119, 255, 0.14)',
            hoverBorderColor: '#1677ff',
            borderWidth: 2,
            fill: true,
            tension: 0.36,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: {
              display: false,
            },
            ticks: {
              display: false,
            },
          },
          y: {
            grid: {
              color: 'rgba(15, 23, 42, 0.06)',
            },
          },
        },
        layout: {
          autoPadding: false,
        },
        plugins: {
          title: {
            display: false,
          },
          legend: {
            display: false,
          },
        },
      },
    };
  };
}
