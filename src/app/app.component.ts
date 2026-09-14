import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HeaderComponent } from './features/dashboard/header/header.component';
import { NetworkPanelComponent } from './features/dashboard/network-panel/network-panel.component';
import { StationPanelComponent } from './features/station/station-panel/station-panel.component';
import { NetworkStatsComponent } from './features/dashboard/network-stats/network-stats.component';
import { DataSourceModalComponent } from './features/dashboard/data-source-modal/data-source-modal.component';
import { TransitMapComponent } from './features/map/transit-map.component';
import { MapService } from './core/services/map.service';
import { TransitDataService } from './core/services/transit-data.service';
import { RealtimeDataService } from './core/services/realtime-data.service';
import { TransitStation } from './core/models/transit.models';
import { Subscription } from 'rxjs';
import { map } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent,
    NetworkPanelComponent,
    StationPanelComponent,
    NetworkStatsComponent,
    DataSourceModalComponent,
    TransitMapComponent
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent implements OnInit, OnDestroy {
  private mapService = inject(MapService);
  public transitData = inject(TransitDataService);
  public realtimeData = inject(RealtimeDataService);

  isLeftPanelOpen = signal<boolean>(typeof window !== 'undefined' && window.innerWidth < 768 ? false : true);
  isRightPanelOpen = signal<boolean>(typeof window !== 'undefined' && window.innerWidth < 768 ? false : true);
  isDataSourceModalOpen = signal<boolean>(false);

  onBackdropClick(): void {
    this.isLeftPanelOpen.set(false);
    this.isRightPanelOpen.set(false);
  }

  readonly selectedStation$ = this.transitData.selectedStation$;
  readonly networkStats$ = this.transitData.networkStats$;
  readonly cameraState$ = this.mapService.cameraState$;
  readonly is3D$ = this.mapService.is3D$;
  readonly vehiclesCount$ = this.realtimeData.vehicles$.pipe(map(v => v.length));
  readonly isRealtimeConnected$ = this.realtimeData.isConnected$;

  private subs = new Subscription();
  private hashChangeHandler = () => this.checkHashRoute();

  ngOnInit(): void {
    // Check initial URL hash deep-link once stations load
    this.subs.add(
      this.transitData.stations$.subscribe(stations => {
        if (stations.length > 0) {
          this.checkHashRoute();
        }
      })
    );

    // Listen to hash changes (e.g. browser back/forward or manual edits)
    window.addEventListener('hashchange', this.hashChangeHandler);
  }

  private checkHashRoute(): void {
    const hash = window.location.hash;
    if (hash.startsWith('#/station/')) {
      const stationId = hash.replace('#/station/', '').split('?')[0].trim();
      if (stationId) {
        const found = this.transitData.selectStationById(stationId);
        if (found) {
          this.mapService.flyTo([found.longitude, found.latitude], 16.2, 58, -15);
          this.isRightPanelOpen.set(true);
        }
      }
    }
  }

  onStationSelected(station: TransitStation): void {
    this.isRightPanelOpen.set(true);
  }

  toggleLeftPanel(): void {
    this.isLeftPanelOpen.update(v => !v);
  }

  toggleRightPanel(): void {
    this.isRightPanelOpen.update(v => !v);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    window.removeEventListener('hashchange', this.hashChangeHandler);
  }
}
