import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { StationSearchComponent } from '../../search/station-search.component';
import { TransitDataService } from '../../../core/services/transit-data.service';
import { MapService } from '../../../core/services/map.service';
import { TransitMode, TransitRoute, TransitStation } from '../../../core/models/transit.models';
import { map } from 'rxjs/operators';
import { combineLatest } from 'rxjs';

@Component({
  selector: 'app-network-panel',
  standalone: true,
  imports: [CommonModule, StationSearchComponent],
  templateUrl: './network-panel.component.html',
  styleUrls: ['./network-panel.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NetworkPanelComponent {
  @Input() isOpen = true;
  @Output() closePanel = new EventEmitter<void>();
  @Output() stationSelected = new EventEmitter<TransitStation>();

  public transitData = inject(TransitDataService);
  private mapService = inject(MapService);

  readonly routes$ = this.transitData.routes$;
  readonly activeMode$ = this.transitData.activeModeFilter$;
  readonly activeLineId$ = this.transitData.activeLineFilter$;

  readonly selectedRoute$ = combineLatest([
    this.transitData.routes$,
    this.transitData.activeLineFilter$
  ]).pipe(
    map(([routes, lineId]) => routes.find(r => r.id === lineId) || null)
  );

  readonly filteredRoutes$ = combineLatest([
    this.transitData.routes$,
    this.transitData.activeModeFilter$
  ]).pipe(
    map(([routes, mode]) => {
      if (mode === 'ALL') return routes;
      return routes.filter(r => r.mode === mode);
    })
  );

  readonly modeCounts$ = combineLatest([
    this.transitData.routes$,
    this.transitData.stations$
  ]).pipe(
    map(([routes, stations]) => {
      return {
        ALL: routes.length,
        MRT: routes.filter(r => r.mode === 'MRT').length,
        LRT: routes.filter(r => r.mode === 'LRT').length,
        MONORAIL: routes.filter(r => r.mode === 'MONORAIL').length,
        KTM: routes.filter(r => r.mode === 'KTM').length,
        BUS: routes.filter(r => r.mode === 'BUS').length
      };
    })
  );

  setModeFilter(mode: string): void {
    this.transitData.setModeFilter(mode);
  }

  toggleLineFilter(lineId: string): void {
    const current = this.transitData.getActiveLineFilter();
    if (current === lineId) {
      this.transitData.setLineFilter(null);
    } else {
      this.transitData.setLineFilter(lineId);
    }
  }

  clearLineFilter(): void {
    this.transitData.setLineFilter(null);
  }

  onStationSelected(station: TransitStation): void {
    this.stationSelected.emit(station);
  }
}
