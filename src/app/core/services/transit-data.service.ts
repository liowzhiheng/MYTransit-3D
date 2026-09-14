import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { FeatureCollection } from 'geojson';
import { BehaviorSubject, Observable, forkJoin, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import {
  NetworkStatistics,
  TransitMode,
  TransitRoute,
  TransitStation
} from '../models/transit.models';

export interface TransitMetadata {
  generatedAt: string;
  source: string;
  totalRoutes: number;
  totalLineSegments: number;
  totalLogicalStations: number;
  totalRawStops: number;
}

@Injectable({
  providedIn: 'root'
})
export class TransitDataService {
  private http = inject(HttpClient);

  private routesSubject = new BehaviorSubject<TransitRoute[]>([]);
  private stationsSubject = new BehaviorSubject<TransitStation[]>([]);
  private routesGeoJsonSubject = new BehaviorSubject<FeatureCollection | null>(null);
  private stationsGeoJsonSubject = new BehaviorSubject<FeatureCollection | null>(null);
  private selectedStationSubject = new BehaviorSubject<TransitStation | null>(null);
  private hoveredStationSubject = new BehaviorSubject<TransitStation | null>(null);
  private metadataSubject = new BehaviorSubject<TransitMetadata | null>(null);
  private activeModeFilterSubject = new BehaviorSubject<string>('ALL');
  private activeLineFilterSubject = new BehaviorSubject<string | null>(null);
  private isLoadingSubject = new BehaviorSubject<boolean>(true);
  private errorSubject = new BehaviorSubject<string | null>(null);
  private isOnlineSubject = new BehaviorSubject<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);

  readonly routes$: Observable<TransitRoute[]> = this.routesSubject.asObservable();
  readonly stations$: Observable<TransitStation[]> = this.stationsSubject.asObservable();
  readonly routesGeoJson$: Observable<FeatureCollection | null> = this.routesGeoJsonSubject.asObservable();
  readonly stationsGeoJson$: Observable<FeatureCollection | null> = this.stationsGeoJsonSubject.asObservable();
  readonly selectedStation$: Observable<TransitStation | null> = this.selectedStationSubject.asObservable();
  readonly hoveredStation$: Observable<TransitStation | null> = this.hoveredStationSubject.asObservable();
  readonly metadata$: Observable<TransitMetadata | null> = this.metadataSubject.asObservable();
  readonly activeModeFilter$: Observable<string> = this.activeModeFilterSubject.asObservable();
  readonly activeLineFilter$: Observable<string | null> = this.activeLineFilterSubject.asObservable();
  readonly isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();
  readonly error$: Observable<string | null> = this.errorSubject.asObservable();
  readonly isOnline$: Observable<boolean> = this.isOnlineSubject.asObservable();

  // Computed Network Statistics stream
  readonly networkStats$: Observable<NetworkStatistics> = this.routes$.pipe(
    map(routes => {
      const stations = this.stationsSubject.value;
      return {
        activeLines: routes.length,
        totalStations: stations.length,
        activeVehicles: null,
        networkStatus: 'OPERATIONAL',
        dataSource: 'Malaysia Government Open Data (data.gov.my)',
        lastUpdated: this.metadataSubject.value?.generatedAt || new Date().toISOString()
      };
    })
  );

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.isOnlineSubject.next(true));
      window.addEventListener('offline', () => this.isOnlineSubject.next(false));
    }
    this.loadTransitData();
  }

  loadTransitData(): void {
    this.isLoadingSubject.next(true);
    this.errorSubject.next(null);

    // Load static preprocessed assets
    forkJoin({
      routes: this.http.get<TransitRoute[]>('assets/transit/routes.json').pipe(catchError(e => of([]))),
      stations: this.http.get<TransitStation[]>('assets/transit/stations.json').pipe(catchError(e => of([]))),
      routesGeoJson: this.http.get<FeatureCollection>('assets/transit/routes.geojson').pipe(catchError(e => of(null))),
      stationsGeoJson: this.http.get<FeatureCollection>('assets/transit/stations.geojson').pipe(catchError(e => of(null))),
      metadata: this.http.get<TransitMetadata>('assets/transit/metadata.json').pipe(catchError(e => of(null)))
    }).subscribe({
      next: data => {
        if (data.routes.length > 0) this.routesSubject.next(data.routes);
        if (data.stations.length > 0) {
          this.stationsSubject.next(data.stations);
          // Set default selected station to Pasar Seni or first station
          const defaultStation = data.stations.find(s => s.name.toLowerCase().includes('pasar seni')) || data.stations[0];
          if (defaultStation) {
            this.selectStation(defaultStation);
          }
        }
        if (data.routesGeoJson) this.routesGeoJsonSubject.next(data.routesGeoJson);
        if (data.stationsGeoJson) this.stationsGeoJsonSubject.next(data.stationsGeoJson);
        if (data.metadata) this.metadataSubject.value || this.metadataSubject.next(data.metadata);

        this.isLoadingSubject.next(false);
      },
      error: err => {
        console.error('[TransitDataService] Failed to load transit assets:', err);
        this.errorSubject.next('Failed to load GTFS assets: ' + err.message);
        this.isLoadingSubject.next(false);
      }
    });
  }

  selectStation(station: TransitStation | null): void {
    if (station) {
      // Provide simulated scheduled headway for demonstration (Phase 1/2)
      const simulatedStation: TransitStation = {
        ...station,
        operationalStatus: 'OPERATIONAL',
        nextServiceMinutes: Math.floor(Math.random() * 4) + 2,
        nextServiceMode: 'SCHEDULED'
      };
      this.selectedStationSubject.next(simulatedStation);
    } else {
      this.selectedStationSubject.next(null);
    }
  }

  selectStationById(id: string): TransitStation | null {
    const stn = this.stationsSubject.value.find(s => s.id === id);
    if (stn) {
      this.selectStation(stn);
      return stn;
    }
    return null;
  }

  setHoveredStation(station: TransitStation | null): void {
    this.hoveredStationSubject.next(station);
  }

  getStations(): TransitStation[] {
    return this.stationsSubject.value;
  }

  getActiveLineFilter(): string | null {
    return this.activeLineFilterSubject.value;
  }

  getActiveModeFilter(): string {
    return this.activeModeFilterSubject.value;
  }

  setModeFilter(mode: string): void {
    this.activeModeFilterSubject.next(mode);
  }

  setLineFilter(lineId: string | null): void {
    this.activeLineFilterSubject.next(lineId);
  }
}
