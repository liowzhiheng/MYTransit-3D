import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TransitStation } from '../../../core/models/transit.models';

export interface LineScheduleItem {
  lineName: string;
  lineCode: string;
  lineColor: string;
  mode: string;
  nextArrivalMinutes: number;
  frequencyMinutes: number;
  status: 'SCHEDULED' | 'REALTIME';
}

@Component({
  selector: 'app-station-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './station-panel.component.html',
  styleUrls: ['./station-panel.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StationPanelComponent {
  @Input() isOpen = true;
  @Input() station: TransitStation | null = null;
  @Output() closePanel = new EventEmitter<void>();

  getModeColor(mode: string): string {
    switch (mode) {
      case 'MRT': return '#008751';
      case 'LRT': return '#e31837';
      case 'MONORAIL': return '#8dc63f';
      case 'KTM': return '#004b87';
      case 'BUS': return '#00bcd4';
      default: return '#64748b';
    }
  }

  getLineColor(lineName: string): string {
    const l = lineName.toLowerCase();
    if (l.includes('kajang')) return '#008751';
    if (l.includes('putrajaya')) return '#ffcd00';
    if (l.includes('kelana jaya')) return '#e31837';
    if (l.includes('ampang')) return '#e57200';
    if (l.includes('sri petaling')) return '#76232f';
    if (l.includes('monorail')) return '#84bd00';
    if (l.includes('ktm') || l.includes('batu caves')) return '#004b87';
    if (l.includes('port klang') || l.includes('tg malim')) return '#c2185b';
    if (l.includes('sunway') || l.includes('brt')) return '#115740';
    return '#38bdf8';
  }

  getLineSchedules(): LineScheduleItem[] {
    if (!this.station) return [];

    return this.station.lines.map((lineName, idx) => {
      const mode = this.getModeForLine(lineName);
      // Realistic timetabled headways (Peak 3-4 min, off-peak 5-8 min)
      const nextArrival = ((this.station!.name.length + idx * 3) % 4) + 2;
      const freq = mode === 'MRT' ? 4 : mode === 'LRT' ? 3 : mode === 'MONORAIL' ? 5 : 15;

      return {
        lineName,
        lineCode: this.getLineCode(lineName),
        lineColor: this.getLineColor(lineName),
        mode,
        nextArrivalMinutes: nextArrival,
        frequencyMinutes: freq,
        status: 'SCHEDULED'
      };
    });
  }

  private getModeForLine(lineName: string): string {
    const l = lineName.toLowerCase();
    if (l.includes('mrt')) return 'MRT';
    if (l.includes('lrt')) return 'LRT';
    if (l.includes('monorail')) return 'MONORAIL';
    if (l.includes('ktm')) return 'KTM';
    if (l.includes('brt') || l.includes('bus')) return 'BUS';
    return this.station?.primaryMode || 'MRT';
  }

  private getLineCode(lineName: string): string {
    const l = lineName.toLowerCase();
    if (l.includes('kajang')) return 'KG';
    if (l.includes('putrajaya')) return 'PY';
    if (l.includes('kelana jaya')) return 'KJ';
    if (l.includes('ampang')) return 'AG';
    if (l.includes('sri petaling')) return 'SP';
    if (l.includes('monorail')) return 'MR';
    if (l.includes('ktm') || l.includes('batu caves')) return 'KC';
    if (l.includes('port klang')) return 'TP';
    if (l.includes('sunway') || l.includes('brt')) return 'BRT';
    return 'KV';
  }
}
