import { Injectable, NgZone, inject } from '@angular/core';
import type { FeatureCollection } from 'geojson';
import { BehaviorSubject, Observable, Subscription, interval, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { TransitStatus, TransitVehicle } from '../models/transit.models';

const FEED_ENDPOINTS = [
  {
    id: 'mrt-feeder',
    name: 'MRT Feeder Bus',
    url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder'
  },
  {
    id: 'ktmb',
    name: 'KTM Komuter',
    url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb'
  },
  {
    id: 'rapid-bus-kl',
    name: 'Rapid Bus KL',
    url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl'
  }
];

const CORS_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`
];

const POLLING_INTERVAL_MS = 30000; // 30 seconds

@Injectable({
  providedIn: 'root'
})
export class RealtimeDataService {
  private zone = inject(NgZone);

  private vehiclesSubject = new BehaviorSubject<TransitVehicle[]>([]);
  private vehicleGeoJsonSubject = new BehaviorSubject<FeatureCollection | null>(null);
  private statusSubject = new BehaviorSubject<TransitStatus>({
    status: 'SCHEDULED',
    source: 'data.gov.my (GTFS Static Schedule)',
    message: 'Operating in scheduled timetable mode. Initializing real-time telemetry...',
    lastUpdated: new Date().toISOString()
  });
  private isPollingSubject = new BehaviorSubject<boolean>(true);
  private isConnectedSubject = new BehaviorSubject<boolean>(false);

  readonly vehicles$: Observable<TransitVehicle[]> = this.vehiclesSubject.asObservable();
  readonly vehicleGeoJson$: Observable<FeatureCollection | null> = this.vehicleGeoJsonSubject.asObservable();
  readonly realtimeStatus$: Observable<TransitStatus> = this.statusSubject.asObservable();
  readonly isPolling$: Observable<boolean> = this.isPollingSubject.asObservable();
  readonly isConnected$: Observable<boolean> = this.isConnectedSubject.asObservable();

  private pollingSubscription: Subscription | null = null;

  constructor() {
    this.startPolling();
  }

  startPolling(): void {
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
    }
    this.isPollingSubject.next(true);

    // Initial fetch immediately
    this.fetchRealtimeFeeds();

    // Periodic polling
    this.pollingSubscription = interval(POLLING_INTERVAL_MS).subscribe(() => {
      if (this.isPollingSubject.value) {
        this.fetchRealtimeFeeds();
      }
    });
  }

  stopPolling(): void {
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
      this.pollingSubscription = null;
    }
    this.isPollingSubject.next(false);
  }

  togglePolling(): void {
    if (this.isPollingSubject.value) {
      this.stopPolling();
    } else {
      this.startPolling();
    }
  }

  private async fetchRealtimeFeeds(): Promise<void> {
    const allVehicles: TransitVehicle[] = [];
    let successfulFeeds = 0;
    let hadCorsOrNetworkError = false;

    for (const feed of FEED_ENDPOINTS) {
      try {
        const buffer = await this.fetchFeedBuffer(feed.url);
        if (buffer) {
          const vehicles = this.decodeProtobufFeed(buffer, feed.name);
          allVehicles.push(...vehicles);
          successfulFeeds++;
        }
      } catch (err: any) {
        hadCorsOrNetworkError = true;
      }
    }

    this.zone.run(() => {
      if (successfulFeeds > 0 && allVehicles.length > 0) {
        this.vehiclesSubject.next(allVehicles);
        this.vehicleGeoJsonSubject.next(this.buildVehicleGeoJson(allVehicles));
        this.isConnectedSubject.next(true);
        this.statusSubject.next({
          status: 'REALTIME',
          source: 'data.gov.my (GTFS-RT Live GPS)',
          message: `Live GPS active: ${allVehicles.length} vehicles tracking across ${successfulFeeds} feeds.`,
          lastUpdated: new Date().toISOString()
        });
      } else if (successfulFeeds > 0 && allVehicles.length === 0) {
        // Feed valid but 0 active vehicles (e.g. night time)
        this.vehiclesSubject.next([]);
        this.vehicleGeoJsonSubject.next(this.buildVehicleGeoJson([]));
        this.isConnectedSubject.next(true);
        this.statusSubject.next({
          status: 'REALTIME',
          source: 'data.gov.my (GTFS-RT Connected)',
          message: 'GTFS-RT connected. 0 vehicles currently on active duty.',
          lastUpdated: new Date().toISOString()
        });
      } else {
        // Fallback to Scheduled Mode conforming to Rule 15
        this.isConnectedSubject.next(false);
        this.statusSubject.next({
          status: 'SCHEDULED',
          source: 'Malaysia Government Open Data (Static Timetable)',
          message: hadCorsOrNetworkError
            ? 'Browser CORS restriction on api.data.gov.my. Seamlessly running in Scheduled Timetable Mode.'
            : 'Live feeds currently offline. Seamlessly running in Scheduled Timetable Mode.',
          lastUpdated: new Date().toISOString()
        });
      }
    });
  }

  private async fetchFeedBuffer(url: string): Promise<Uint8Array | null> {
    // 1. Attempt direct browser fetch first
    try {
      const directResponse = await fetch(url, { method: 'GET', mode: 'cors' });
      if (directResponse.ok) {
        const arrayBuf = await directResponse.arrayBuffer();
        return new Uint8Array(arrayBuf);
      }
    } catch {
      // Direct fetch failed (likely CORS or offline)
    }

    // 2. Attempt open CORS proxy fallback
    for (const makeProxyUrl of CORS_PROXIES) {
      try {
        const proxyUrl = makeProxyUrl(url);
        const proxyResponse = await fetch(proxyUrl);
        if (proxyResponse.ok) {
          const arrayBuf = await proxyResponse.arrayBuffer();
          if (arrayBuf.byteLength > 10) {
            return new Uint8Array(arrayBuf);
          }
        }
      } catch {
        // Continue to next fallback
      }
    }

    return null;
  }

  private decodeProtobufFeed(buffer: Uint8Array, sourceName: string): TransitVehicle[] {
    try {
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
      const vehicles: TransitVehicle[] = [];

      for (const entity of feed.entity) {
        if (entity.vehicle && entity.vehicle.position) {
          const pos = entity.vehicle.position;
          const lat = pos.latitude;
          const lon = pos.longitude;

          // Spatial boundary validation: Klang Valley / Selangor region
          if (lat && lon && lat >= 2.6 && lat <= 3.8 && lon >= 101.1 && lon <= 102.2) {
            const vehicleId = entity.vehicle.vehicle?.id || entity.vehicle.vehicle?.licensePlate || entity.id;
            const routeId = entity.vehicle.trip?.routeId || 'TRANSIT';
            const timestamp = entity.vehicle.timestamp ? String(entity.vehicle.timestamp) : undefined;

            vehicles.push({
              id: vehicleId,
              routeId,
              latitude: Number(lat.toFixed(6)),
              longitude: Number(lon.toFixed(6)),
              bearing: pos.bearing || 0,
              status: pos.speed ? `${Math.round(pos.speed * 3.6)} km/h` : 'IN TRANSIT',
              timestamp,
              source: sourceName
            });
          }
        }
      }

      return vehicles;
    } catch (e) {
      console.warn(`[RealtimeDataService] Protobuf parse error for ${sourceName}:`, e);
      return [];
    }
  }

  private buildVehicleGeoJson(vehicles: TransitVehicle[]): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: vehicles.map(v => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [v.longitude, v.latitude]
        },
        properties: {
          id: v.id,
          routeId: v.routeId,
          bearing: v.bearing || 0,
          status: v.status || 'ACTIVE',
          source: v.source,
          timestamp: v.timestamp || ''
        }
      }))
    };
  }
}
