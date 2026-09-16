import { ChangeDetectionStrategy, Component, EventEmitter, OnDestroy, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RealtimeDataService } from '../../../core/services/realtime-data.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeaderComponent implements OnInit, OnDestroy {
  @Output() toggleLeftPanel = new EventEmitter<void>();
  @Output() openDataSources = new EventEmitter<void>();

  public realtimeData = inject(RealtimeDataService);

  readonly isConnected$ = this.realtimeData.isConnected$;
  readonly isPolling$ = this.realtimeData.isPolling$;
  readonly vehicles$ = this.realtimeData.vehicles$;

  currentTime = signal<string>('');
  currentDate = signal<string>('');
  private timerInterval: any;

  ngOnInit(): void {
    this.updateClock();
    this.timerInterval = setInterval(() => {
      this.updateClock();
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
  }

  private updateClock(): void {
    const now = new Date();
    // Format UTC+8 Malaysia Time
    const timeStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(now);

    const dateStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(now);

    this.currentTime.set(timeStr);
    this.currentDate.set(dateStr);
  }
}
