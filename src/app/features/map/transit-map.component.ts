import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  NgZone,
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

  public mapService = inject(MapService);
  public transitData = inject(TransitDataService);
  public realtimeData = inject(RealtimeDataService);
  private cdr = inject(ChangeDetectorRef);
  private zone = inject(NgZone);

  readonly isMapLoaded$ = this.mapService.isMapLoaded$;
  readonly is3D$ = this.mapService.is3D$;
  readonly cameraState$ = this.mapService.cameraState$;
  readonly mapError$ = this.mapService.error$;

  private resizeObserver: ResizeObserver | null = null;
  private subs = new Subscription();

  isLocating = false;
  locationError: string | null = null;

  remoteObserver: {
    isActive: boolean;
    regionName: string;
    distKm: number;
    lat: number;
    lng: number;
  } | null = null;

  localCommuterInfo: {
    nearestStationName: string;
    distanceMeters: number;
    walkMinutes: number;
  } | null = null;

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

  locateUser(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.locationError = 'Geolocation is not supported by your browser environment.';
      setTimeout(() => (this.locationError = null), 4500);
      return;
    }

    this.isLocating = true;
    this.locationError = null;

    navigator.geolocation.getCurrentPosition(
      pos => {
        this.zone.run(() => {
          this.isLocating = false;
          this.handleUserPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
          this.cdr.markForCheck();
        });
      },
      err => {
        this.zone.run(() => {
          this.isLocating = false;
          if (err.code === err.PERMISSION_DENIED) {
            this.locationError = 'Location access denied. Running in standard Digital Twin mode.';
          } else {
            this.locationError = 'Unable to determine GPS location.';
          }
          this.cdr.markForCheck();
          setTimeout(() => {
            this.locationError = null;
            this.cdr.markForCheck();
          }, 4500);
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  private handleUserPosition(lat: number, lng: number, accuracy: number): void {
    // Klang Valley geofence: Lat 2.6 to 3.6, Lng 101.1 to 102.2
    const inKlangValley = lat >= 2.6 && lat <= 3.6 && lng >= 101.1 && lng <= 102.2;

    if (inKlangValley) {
      this.remoteObserver = null;
      this.mapService.setUserLocation([lng, lat], accuracy);
      this.mapService.flyTo([lng, lat], 15.6, 50, 0);
      this.detectNearestStation(lat, lng);
    } else {
      // User is outside Klang Valley (e.g. Johor, Penang, overseas)
      // DO NOT fly camera out to empty Johor! Keep KL ops center focused.
      const distKm = Math.round(this.haversineDistance([lng, lat], [101.6869, 3.139]) / 1000);
      let region = 'Remote Region';
      if (lat >= 1.2 && lat <= 2.5 && lng >= 102.5 && lng <= 104.5) {
        region = 'Johor / Southern Region';
      } else if (lat >= 5.0 && lat <= 6.5) {
        region = 'Penang / Northern Region';
      } else if (lat >= 1.5 && lat <= 5.5 && lng > 109) {
        region = 'East Malaysia (Sabah/Sarawak)';
      } else if (lat < 1.48 && lng > 103.5 && lng < 104.1) {
        region = 'Singapore Sector';
      }

      this.localCommuterInfo = null;
      this.remoteObserver = {
        isActive: true,
        regionName: region,
        distKm,
        lat: Number(lat.toFixed(4)),
        lng: Number(lng.toFixed(4))
      };
    }
    this.cdr.markForCheck();
  }

  private detectNearestStation(lat: number, lng: number): void {
    const stations = this.transitData.getStations();
    if (!stations || stations.length === 0) return;

    let nearest = stations[0];
    let minDistance = Infinity;

    for (const s of stations) {
      const d = this.haversineDistance([lng, lat], [s.longitude, s.latitude]);
      if (d < minDistance) {
        minDistance = d;
        nearest = s;
      }
    }

    const distMeters = Math.round(minDistance);
    const walkMinutes = Math.max(1, Math.round(distMeters / 80));

    this.localCommuterInfo = {
      nearestStationName: nearest.name,
      distanceMeters: distMeters,
      walkMinutes
    };

    // Auto-select nearest station in dashboard
    this.transitData.selectStation(nearest);
    this.cdr.markForCheck();
  }

  simulateLocation(coords: [number, number], stationName: string): void {
    this.zone.run(() => {
      this.remoteObserver = null;
      this.mapService.setUserLocation(coords, 15);
      this.mapService.flyTo(coords, 15.8, 50, 0);
      this.detectNearestStation(coords[1], coords[0]);
      this.cdr.markForCheck();
    });
  }

  dismissRemoteObserver(): void {
    this.remoteObserver = null;
    this.cdr.markForCheck();
  }

  dismissLocalCommuterInfo(): void {
    this.localCommuterInfo = null;
    this.cdr.markForCheck();
  }

  private haversineDistance(c1: [number, number], c2: [number, number]): number {
    const R = 6371000;
    const dLat = ((c2[1] - c1[1]) * Math.PI) / 180;
    const dLng = ((c2[0] - c1[0]) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((c1[1] * Math.PI) / 180) *
        Math.cos((c2[1] * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
