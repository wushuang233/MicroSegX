import {
  Component,
  Input,
  OnInit,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { ContainersService } from '@common/services/containers.service';

@Component({
  standalone: false,
  selector: 'app-members',
  templateUrl: './members.component.html',
  styleUrls: ['./members.component.scss'],
})
export class MembersComponent implements OnInit, OnChanges {
  @Input() source: string = '';
  @Input() groupName: string = '';
  @Input() resizableHeight: number = 0;
  @Input() members: any;
  @Input() kind: string = '';
  @Input() useQuickFilterService: boolean = false;
  memberGridRowData: any;

  constructor(private containersService: ContainersService) {}

  ngOnInit(): void {
    this.syncMemberGridRowData();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.members || changes.kind || changes.groupName) {
      this.syncMemberGridRowData();
    }
  }

  private syncMemberGridRowData() {
    const members = this.members || [];
    this.memberGridRowData =
      this.kind === 'node'
        ? members
        : this.containersService.formatScannedWorkloads(members);
  }
}
