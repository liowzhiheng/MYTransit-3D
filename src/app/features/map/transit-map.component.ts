import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MapService } from '../../core/services/map.service';
import { TransitDataService } from '../../core/services/transit-data.service';
import { RealtimeDataService } from '../../core/services/realtime-data.service';
import { Subscription, combineLatest } from 'rxjs';

@Component({
  selector: 'app-transit-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './transit-map.component.html',
  styleUrls: ['./transit-map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TransitMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef<HTMLDivElement>;
  @Input() isRightPanelOpen = true;

  public mapService = inject(MapService);
  public transitData = inject(TransitDataService);
  public realtimeData = inject(RealtimeDataService);

  readonly isMapLoaded$ = this.mapService.isMapLoaded$;
  readonly is3D$ = this.mapService.is3D$;
  readonly cameraState$ = this.mapService.cameraState$;
  readonly mapError$ = this.mapService.error$;

  private resizeObserver: ResizeObserver | null = null;
  private subs = new Subscription();

  ngAfterViewInit(): void {
    if (this.mapContainer?.nativeElement) {
      this.mapService.initMap(this.mapContainer.nativeElement);

      // Force canvas layout calculation
      setTimeout(() => this.mapService.resize(), 50);
      setTimeout(() => this.mapService.resize(), 300);

      // Listen for container resize
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => {
          this.mapService.resize();
        });
        this.resizeObserver.observe(this.mapContainer.nativeElement);
      }

      // When map is loaded and transit GeoJSON data arrives, inject into map
      this.subs.add(
        combineLatest([
          this.mapService.isMapLoaded$,
          this.transitData.routesGeoJson$,
          this.transitData.stationsGeoJson$
        ]).subscribe(([loaded, routesGeoJson, stationsGeoJson]) => {
          if (loaded && routesGeoJson && stationsGeoJson) {
            this.mapService.setTransitData(routesGeoJson, stationsGeoJson);
          }
        })
      );

      // When map is loaded and real-time vehicles arrive, inject into map
      this.subs.add(
        combineLatest([
          this.mapService.isMapLoaded$,
          this.realtimeData.vehicleGeoJson$
        ]).subscribe(([loaded, vehicleGeoJson]) => {
          if (loaded && vehicleGeoJson) {
            this.mapService.setVehicles(vehicleGeoJson);
          }
        })
      );

      // Highlight selected station
      this.subs.add(
        combineLatest([
          this.mapService.isMapLoaded$,
          this.transitData.selectedStation$
        ]).subscribe(([loaded, station]) => {
          if (loaded) {
            this.mapService.highlightStation(station);
          }
        })
      );

      // Listen to station click on map
      this.subs.add(
        this.mapService.stationClicked$.subscribe(stationId => {
          this.transitData.selectStationById(stationId);
        })
      );

      // Mode filter reaction
      this.subs.add(
        combineLatest([
          this.mapService.isMapLoaded$,
          this.transitData.activeModeFilter$
        ]).subscribe(([loaded, mode]) => {
          if (loaded) {
            this.mapService.filterByMode(mode);
          }
        })
      );

      // Line filter reaction
      this.subs.add(
        combineLatest([
          this.mapService.isMapLoaded$,
          this.transitData.activeLineFilter$
        ]).subscribe(([loaded, lineId]) => {
          if (loaded) {
            this.mapService.filterByLine(lineId);
          }
        })
      );
    }
  }

  toggle3D(): void {
    this.mapService.toggle3DMode();
  }

  resetView(): void {
    this.mapService.flyToKualaLumpur();
  }

  resetBearing(): void {
    this.mapService.resetBearingAndPitch();
  }

  zoomIn(): void {
    this.mapService.zoomIn();
  }

  zoomOut(): void {
    this.mapService.zoomOut();
  }

  toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.mapService.destroyMap();
  }
}
