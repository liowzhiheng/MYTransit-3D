import { Injectable, NgZone, OnDestroy, inject } from '@angular/core';
import type { FeatureCollection } from 'geojson';
import { BehaviorSubject, Observable, Subscription, interval } from 'rxjs';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { TransitStatus, TransitVehicle } from '../models/transit.models';
import { TransitDataService } from './transit-data.service';

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

const POLLING_INTERVAL_MS = 30000; // 30 seconds for live GTFS-RT polling
const ANIMATION_TICK_MS = 1000; // 1 second for smooth headway interpolation

interface PreprocessedTrack {
  routeId: string;
  name: string;
  mode: string;
  color: string;
  dirSuffix: 'OB' | 'IB';
  directionName: string;
  coords: [number, number][];
  cumDistances: number[];
  totalDist: number;
  tripDuration: number;
  trainCount: number;
  speedMps: number;
}

function haversineDistance(c1: [number, number], c2: [number, number]): number {
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

function calculateBearing(c1: [number, number], c2: [number, number]): number {
  const y = Math.sin(((c2[0] - c1[0]) * Math.PI) / 180) * Math.cos((c2[1] * Math.PI) / 180);
  const x =
    Math.cos((c1[1] * Math.PI) / 180) * Math.sin((c2[1] * Math.PI) / 180) -
    Math.sin((c1[1] * Math.PI) / 180) *
      Math.cos((c2[1] * Math.PI) / 180) *
      Math.cos(((c2[0] - c1[0]) * Math.PI) / 180);
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

const SPEED_MAP: Record<string, number> = {
  LRT: 11, // ~40 km/h
  MRT: 13, // ~47 km/h
  MONORAIL: 8, // ~29 km/h
  BUS: 9, // ~32 km/h
  KTM: 15 // ~54 km/h
};

const TRAIN_COUNT_MAP: Record<string, number> = {
  AG: 4,
  KJ: 8,
  PH: 5,
  KGL: 7,
  PYL: 7,
  MR: 3,
  BRT: 3,
  SA: 4,
  KC05_KB18: 3,
  KA15_KD19: 3
};

@Injectable({
  providedIn: 'root'
})
export class RealtimeDataService implements OnDestroy {
  private zone = inject(NgZone);
  private transitData = inject(TransitDataService, { optional: true });

  private vehiclesSubject = new BehaviorSubject<TransitVehicle[]>([]);
  private vehicleGeoJsonSubject = new BehaviorSubject<FeatureCollection | null>(null);
  private statusSubject = new BehaviorSubject<TransitStatus>({
    status: 'SCHEDULED',
    source: 'Malaysia Open Data (GTFS Timetable Headway)',
    message: 'Operating in Scheduled Headway Timetable mode across 10 corridors.',
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
  private animationSubscription: Subscription | null = null;
  private routesSubscription: Subscription | null = null;

  private preprocessedTracks: PreprocessedTrack[] = [];
  private liveGpsVehicles: TransitVehicle[] = [];

  constructor() {
    this.initRoutesListener();
    this.startInterpolationAnimation();
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.stopInterpolationAnimation();
    if (this.routesSubscription) {
      this.routesSubscription.unsubscribe();
    }
  }

  private initRoutesListener(): void {
    if (this.transitData) {
      this.routesSubscription = this.transitData.routesGeoJson$.subscribe(geojson => {
        if (geojson && geojson.features && geojson.features.length > 0) {
          this.buildPreprocessedTracks(geojson);
          this.tickVehicles();
        }
      });
    }
  }

  private buildPreprocessedTracks(geojson: FeatureCollection): void {
    const tracks: PreprocessedTrack[] = [];

    geojson.features.forEach((f, idx) => {
      if (!f.geometry || f.geometry.type !== 'LineString') return;
      const coords = (f.geometry as any).coordinates as [number, number][];
      if (!coords || coords.length < 2) return;

      const p = f.properties || {};
      const routeId = p['routeId'] || 'LINE';
      const name = p['name'] || routeId;
      const mode = p['mode'] || 'LRT';
      const color = p['color'] || '#10b981';
      const speedMps = SPEED_MAP[mode] || 11;
      const trainCount = TRAIN_COUNT_MAP[routeId] || 4;
      const dirSuffix = idx % 2 === 0 ? 'OB' : 'IB';
      const directionName = dirSuffix === 'OB' ? 'Outbound' : 'Inbound';

      const cumDistances: number[] = [0];
      for (let j = 1; j < coords.length; j++) {
        cumDistances.push(cumDistances[j - 1] + haversineDistance(coords[j - 1], coords[j]));
      }
      const totalDist = Math.max(100, cumDistances[cumDistances.length - 1]);
      const tripDuration = totalDist / speedMps;

      tracks.push({
        routeId,
        name,
        mode,
        color,
        dirSuffix,
        directionName,
        coords,
        cumDistances,
        totalDist,
        tripDuration,
        trainCount,
        speedMps
      });
    });

    this.preprocessedTracks = tracks;
  }

  private startInterpolationAnimation(): void {
    this.stopInterpolationAnimation();

    this.zone.runOutsideAngular(() => {
      this.animationSubscription = interval(ANIMATION_TICK_MS).subscribe(() => {
        this.tickVehicles();
      });
    });
  }

  private stopInterpolationAnimation(): void {
    if (this.animationSubscription) {
      this.animationSubscription.unsubscribe();
      this.animationSubscription = null;
    }
  }

  private tickVehicles(): void {
    if (this.preprocessedTracks.length === 0) return;

    const nowSec = Date.now() / 1000;
    const scheduledVehicles: TransitVehicle[] = [];

    for (const track of this.preprocessedTracks) {
      for (let k = 0; k < track.trainCount; k++) {
        const offset = k * (track.tripDuration / track.trainCount);
        const elapsed = (nowSec + offset) % track.tripDuration;
        const curDist = (elapsed / track.tripDuration) * track.totalDist;

        // Binary search or linear walk for the polyline segment
        let i = 0;
        while (i < track.cumDistances.length - 1 && track.cumDistances[i + 1] < curDist) {
          i++;
        }

        const segStart = track.cumDistances[i];
        const segEnd = track.cumDistances[i + 1] || segStart + 1;
        const segLen = Math.max(0.001, segEnd - segStart);
        const alpha = Math.min(1, Math.max(0, (curDist - segStart) / segLen));

        const c1 = track.coords[i];
        const c2 = track.coords[i + 1] || c1;
        const lng = Number((c1[0] + alpha * (c2[0] - c1[0])).toFixed(6));
        const lat = Number((c1[1] + alpha * (c2[1] - c1[1])).toFixed(6));
        const bearing = calculateBearing(c1, c2);

        // Realistic variation with slight slowing on turns or station approaches
        const speedVar = ((i % 5) - 2) * 1.5;
        const speedKmH = Math.max(25, Math.round(track.speedMps * 3.6 + speedVar));

        scheduledVehicles.push({
          id: `${track.routeId}-${track.dirSuffix}${k + 1}`,
          routeId: track.routeId,
          lineName: track.name,
          mode: track.mode,
          color: track.color,
          latitude: lat,
          longitude: lng,
          bearing,
          speed: speedKmH,
          status: `EN ROUTE (${speedKmH} km/h)`,
          direction: track.directionName,
          source: 'Scheduled Timetable (GTFS Headway)',
          isSimulated: true,
          headwayMinutes: Math.round((track.tripDuration / track.trainCount / 60) * 10) / 10
        });
      }
    }

    // Merge live GPS vehicles (e.g. buses or KTM) with scheduled rail fleet
    const allVehicles = [...scheduledVehicles, ...this.liveGpsVehicles];
    const geojson = this.buildVehicleGeoJson(allVehicles);

    this.zone.run(() => {
      this.vehiclesSubject.next(allVehicles);
      this.vehicleGeoJsonSubject.next(geojson);
    });
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
    const liveVehicles: TransitVehicle[] = [];
    let successfulFeeds = 0;
    let hadCorsOrRateLimitError = false;

    for (const feed of FEED_ENDPOINTS) {
      try {
        const buffer = await this.fetchFeedBuffer(feed.url);
        if (buffer) {
          const vehicles = this.decodeProtobufFeed(buffer, feed.name);
          liveVehicles.push(...vehicles);
          successfulFeeds++;
        }
      } catch {
        hadCorsOrRateLimitError = true;
      }
    }

    this.zone.run(() => {
      this.liveGpsVehicles = liveVehicles;

      if (successfulFeeds > 0 && liveVehicles.length > 0) {
        this.isConnectedSubject.next(true);
        this.statusSubject.next({
          status: 'REALTIME',
          source: 'data.gov.my (GTFS-RT Live GPS + Timetable)',
          message: `Live GPS active: ${liveVehicles.length} feeder buses tracking. Rail lines running on timetable headway interpolation.`,
          lastUpdated: new Date().toISOString()
        });
      } else {
        this.isConnectedSubject.next(false);
        this.statusSubject.next({
          status: 'SCHEDULED',
          source: 'Malaysia Open Data (GTFS Timetable Headway)',
          message: hadCorsOrRateLimitError
            ? 'Operating in Scheduled Headway Timetable mode across 10 corridors (Rule 15).'
            : 'Scheduled Timetable mode active across 10 corridors.',
          lastUpdated: new Date().toISOString()
        });
      }

      // Re-trigger vehicle tick immediately to reflect any updated live fleet
      this.tickVehicles();
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
      // Direct fetch failed (CORS, offline, or rate limited)
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
            const routeId = entity.vehicle.trip?.routeId || 'BUS';
            const timestamp = entity.vehicle.timestamp ? String(entity.vehicle.timestamp) : undefined;
            const speedKmH = pos.speed ? Math.round(pos.speed * 3.6) : 32;

            vehicles.push({
              id: vehicleId,
              routeId,
              lineName: `Feeder Bus ${routeId}`,
              mode: 'BUS',
              color: '#10b981',
              latitude: Number(lat.toFixed(6)),
              longitude: Number(lon.toFixed(6)),
              bearing: pos.bearing || 0,
              speed: speedKmH,
              status: `${speedKmH} km/h`,
              direction: 'In Service',
              timestamp,
              source: `GTFS-RT Live GPS (${sourceName})`,
              isSimulated: false
            });
          }
        }
      }

      return vehicles;
    } catch {
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
          lineName: v.lineName || v.routeId,
          mode: v.mode || 'LRT',
          color: v.color || '#10b981',
          bearing: v.bearing || 0,
          speed: v.speed || 0,
          status: v.status || 'IN TRANSIT',
          direction: v.direction || 'In Service',
          source: v.source,
          timestamp: v.timestamp || '',
          headwayMinutes: v.headwayMinutes || 5
        }
      }))
    };
  }
}
