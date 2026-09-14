import { Injectable, NgZone, inject } from '@angular/core';
import * as maplibregl from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { MapCameraState, TransitStation } from '../models/transit.models';

export const KL_COORDINATES: [number, number] = [101.6961, 3.1424]; // Kuala Lumpur Central (Pasar Seni / Merdeka)
export const DEFAULT_ZOOM = 13.5;
export const DEFAULT_PITCH = 50;
export const DEFAULT_BEARING = -15;

const PRIMARY_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const FALLBACK_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

@Injectable({
  providedIn: 'root'
})
export class MapService {
  private zone = inject(NgZone);
  private map: maplibregl.Map | null = null;
  private isMapLoadedSubject = new BehaviorSubject<boolean>(false);
  private is3DSubject = new BehaviorSubject<boolean>(true);
  private cameraStateSubject = new BehaviorSubject<MapCameraState>({
    center: KL_COORDINATES,
    zoom: DEFAULT_ZOOM,
    pitch: DEFAULT_PITCH,
    bearing: DEFAULT_BEARING,
    is3D: true
  });
  private errorSubject = new BehaviorSubject<string | null>(null);
  private stationClickedSubject = new Subject<string>(); // emits station ID

  // Cached GeoJSON references for reload/style changes
  private cachedRoutesGeoJson: FeatureCollection | null = null;
  private cachedStationsGeoJson: FeatureCollection | null = null;
  private selectedStationCoords: [number, number] | null = null;

  readonly isMapLoaded$: Observable<boolean> = this.isMapLoadedSubject.asObservable();
  readonly is3D$: Observable<boolean> = this.is3DSubject.asObservable();
  readonly cameraState$: Observable<MapCameraState> = this.cameraStateSubject.asObservable();
  readonly error$: Observable<string | null> = this.errorSubject.asObservable();
  readonly stationClicked$: Observable<string> = this.stationClickedSubject.asObservable();

  initMap(container: HTMLElement | string): maplibregl.Map {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    this.isMapLoadedSubject.next(false);
    this.errorSubject.next(null);

    this.zone.runOutsideAngular(() => {
      try {
        const mapInstance = new maplibregl.Map({
          container,
          style: PRIMARY_STYLE_URL,
          center: KL_COORDINATES,
          zoom: DEFAULT_ZOOM,
          pitch: DEFAULT_PITCH,
          bearing: DEFAULT_BEARING,
          maxPitch: 75,
          attributionControl: false
        });

        this.map = mapInstance;

        mapInstance.addControl(
          new maplibregl.AttributionControl({
            compact: true,
            customAttribution:
              '© <a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> | Transit: <a href="https://data.gov.my" target="_blank">data.gov.my</a>'
          }),
          'bottom-right'
        );

        let hasInitializedLayers = false;
        const onMapReady = () => {
          if (hasInitializedLayers || !this.map) return;
          hasInitializedLayers = true;
          this.zone.run(() => {
            this.setup3DBuildings();
            if (this.cachedRoutesGeoJson && this.cachedStationsGeoJson) {
              this.applyTransitLayers(this.cachedRoutesGeoJson, this.cachedStationsGeoJson);
            }
            this.isMapLoadedSubject.next(true);
            this.updateCameraState();
            setTimeout(() => this.resize(), 100);
          });
        };

        mapInstance.on('load', onMapReady);

        // Safety fallback: Ensure digital twin renders within 2.5s regardless of external tile latency
        setTimeout(() => {
          if (!this.isMapLoadedSubject.value) {
            console.info('[MapService] Activating transit layers via readiness timeout fallback');
            onMapReady();
          }
        }, 2500);

        mapInstance.on('move', () => {
          this.zone.run(() => {
            this.updateCameraState();
          });
        });

        mapInstance.on('error', e => {
          console.warn('[MapService] MapLibre event warning:', e.error?.message || e);
        });
      } catch (err) {
        this.zone.run(() => {
          this.errorSubject.next('MapLibre GL initialization failed: ' + (err as Error).message);
        });
      }
    });

    return this.map!;
  }

  /**
   * Sets up or updates transit network GeoJSON sources and visualization layers
   */
  setTransitData(
    routesGeoJson: FeatureCollection,
    stationsGeoJson: FeatureCollection
  ): void {
    this.cachedRoutesGeoJson = routesGeoJson;
    this.cachedStationsGeoJson = stationsGeoJson;

    if (this.map && (this.map.isStyleLoaded() || this.isMapLoadedSubject.value)) {
      this.applyTransitLayers(routesGeoJson, stationsGeoJson);
    }
  }

  private applyTransitLayers(
    routesGeoJson: FeatureCollection,
    stationsGeoJson: FeatureCollection
  ): void {
    if (!this.map) return;

    try {
      // 1. Routes Source & Layers
      if (this.map.getSource('transit-routes')) {
        (this.map.getSource('transit-routes') as maplibregl.GeoJSONSource).setData(routesGeoJson);
      } else {
        this.map.addSource('transit-routes', {
          type: 'geojson',
          data: routesGeoJson
        });

        // Glow layer for futuristic digital twin look
        this.map.addLayer({
          id: 'transit-routes-glow',
          type: 'line',
          source: 'transit-routes',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['coalesce', ['get', 'color'], '#00f2fe'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 7, 17, 12],
            'line-blur': 4,
            'line-opacity': 0.45
          }
        });

        // Dark contrast casing
        this.map.addLayer({
          id: 'transit-routes-casing',
          type: 'line',
          source: 'transit-routes',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#060b13',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 5, 17, 8],
            'line-opacity': 0.95
          }
        });

        // Vibrant center line
        this.map.addLayer({
          id: 'transit-routes-line',
          type: 'line',
          source: 'transit-routes',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['coalesce', ['get', 'color'], '#00f2fe'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 14, 3.2, 17, 5.5],
            'line-opacity': 1
          }
        });
      }

      // 2. Stations Source & Layers
      if (this.map.getSource('transit-stations')) {
        (this.map.getSource('transit-stations') as maplibregl.GeoJSONSource).setData(stationsGeoJson);
      } else {
        this.map.addSource('transit-stations', {
          type: 'geojson',
          data: stationsGeoJson
        });

        // Outer telemetry ring
        this.map.addLayer({
          id: 'transit-stations-ring',
          type: 'circle',
          source: 'transit-stations',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 14, 7, 17, 10],
            'circle-color': 'transparent',
            'circle-stroke-width': 1.6,
            'circle-stroke-color': ['coalesce', ['get', 'color'], '#00f2fe'],
            'circle-stroke-opacity': 0.8
          }
        });

        // Core station node
        this.map.addLayer({
          id: 'transit-stations-circle',
          type: 'circle',
          source: 'transit-stations',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 17, 7],
            'circle-color': ['coalesce', ['get', 'color'], '#ffffff'],
            'circle-stroke-width': 1.2,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 1
          }
        });

        // Station text label (visible at zoom >= 13)
        this.map.addLayer({
          id: 'transit-stations-label',
          type: 'symbol',
          source: 'transit-stations',
          minzoom: 13,
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12.5],
            'text-offset': [0, 0.9],
            'text-anchor': 'top',
            'text-optional': true
          },
          paint: {
            'text-color': '#f8fafc',
            'text-halo-color': '#070c16',
            'text-halo-width': 2.2,
            'text-halo-blur': 0.5
          }
        });

        // Station Selection Halo Layer
        this.setupSelectionLayer();

        // Mouse hover and click events
        this.setupStationInteractions();
      }
    } catch (err) {
      console.warn('[MapService] Error applying transit layers:', err);
    }
  }

  private setupSelectionLayer(): void {
    if (!this.map) return;

    if (!this.map.getSource('selected-station-source')) {
      this.map.addSource('selected-station-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: []
        }
      });

      this.map.addLayer({
        id: 'transit-station-selected-halo',
        type: 'circle',
        source: 'selected-station-source',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 16, 17, 22],
          'circle-color': 'transparent',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#00f2fe',
          'circle-stroke-opacity': 0.9
        }
      });
    }
  }

  highlightStation(station: TransitStation | null): void {
    if (!this.map) return;
    const source = this.map.getSource('selected-station-source') as maplibregl.GeoJSONSource;
    if (!source) return;

    if (station) {
      this.selectedStationCoords = [station.longitude, station.latitude];
      source.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [station.longitude, station.latitude]
            },
            properties: {
              id: station.id,
              name: station.name
            }
          }
        ]
      });
    } else {
      this.selectedStationCoords = null;
      source.setData({
        type: 'FeatureCollection',
        features: []
      });
    }
  }

  private setupStationInteractions(): void {
    if (!this.map) return;

    const interactiveLayers = ['transit-stations-circle', 'transit-stations-ring'];

    for (const layerId of interactiveLayers) {
      this.map.on('click', layerId, e => {
        if (!e.features || e.features.length === 0) return;
        const feature = e.features[0];
        const stationId = feature.properties?.['id'];
        if (stationId) {
          this.zone.run(() => {
            this.stationClickedSubject.next(stationId);
          });
        }
      });

      this.map.on('mouseenter', layerId, () => {
        if (this.map) this.map.getCanvas().style.cursor = 'pointer';
      });

      this.map.on('mouseleave', layerId, () => {
        if (this.map) this.map.getCanvas().style.cursor = '';
      });
    }
  }

  private activeVehiclePopup: maplibregl.Popup | null = null;

  /**
   * Render real-time vehicle positions on MapLibre
   */
  setVehicles(geoJson: FeatureCollection): void {
    if (!this.map || !this.map.isStyleLoaded()) return;

    try {
      const source = this.map.getSource('transit-vehicles') as maplibregl.GeoJSONSource;
      if (source) {
        source.setData(geoJson);
      } else {
        this.map.addSource('transit-vehicles', {
          type: 'geojson',
          data: geoJson
        });

        // Vehicle outer glow
        this.map.addLayer({
          id: 'transit-vehicles-glow',
          type: 'circle',
          source: 'transit-vehicles',
          paint: {
            'circle-radius': 9,
            'circle-color': '#10b981',
            'circle-opacity': 0.35,
            'circle-blur': 0.8
          }
        });

        // Vehicle core dot
        this.map.addLayer({
          id: 'transit-vehicles-circle',
          type: 'circle',
          source: 'transit-vehicles',
          paint: {
            'circle-radius': 4.5,
            'circle-color': '#10b981',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff'
          }
        });

        // Vehicle route badge label
        this.map.addLayer({
          id: 'transit-vehicles-label',
          type: 'symbol',
          source: 'transit-vehicles',
          minzoom: 12,
          layout: {
            'text-field': ['get', 'routeId'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 9.5,
            'text-offset': [0, -1.2],
            'text-anchor': 'bottom'
          },
          paint: {
            'text-color': '#10b981',
            'text-halo-color': '#060b13',
            'text-halo-width': 2
          }
        });

        // Vehicle click interaction
        this.map.on('click', 'transit-vehicles-circle', (e) => {
          if (!e.features || e.features.length === 0 || !this.map) return;
          const f = e.features[0];
          const coords = (f.geometry as any).coordinates.slice() as [number, number];
          const p = f.properties;

          if (this.activeVehiclePopup) {
            this.activeVehiclePopup.remove();
          }

          const html = `
            <div style="background:#0a111e; color:#f8fafc; padding:8px 10px; border-radius:6px; font-family:monospace; font-size:11px; border:1px solid #10b981;">
              <div style="font-weight:700; color:#10b981; margin-bottom:4px;">VEHICLE // LIVE GPS</div>
              <div><strong>ID:</strong> ${p?.['id'] || '--'}</div>
              <div><strong>ROUTE:</strong> ${p?.['routeId'] || '--'}</div>
              <div><strong>SPEED:</strong> ${p?.['status'] || '--'}</div>
              <div><strong>SOURCE:</strong> ${p?.['source'] || 'GTFS-RT'}</div>
            </div>
          `;

          this.activeVehiclePopup = new maplibregl.Popup({ offset: 12, closeButton: true })
            .setLngLat(coords)
            .setHTML(html)
            .addTo(this.map);
        });

        this.map.on('mouseenter', 'transit-vehicles-circle', () => {
          if (this.map) this.map.getCanvas().style.cursor = 'pointer';
        });
        this.map.on('mouseleave', 'transit-vehicles-circle', () => {
          if (this.map) this.map.getCanvas().style.cursor = '';
        });
      }
    } catch (err) {
      console.warn('[MapService] Error setting vehicles:', err);
    }
  }

  /**
   * Filter transit layers by Mode (MRT, LRT, MONORAIL, KTM, BUS, or ALL)
   */
  filterByMode(mode: string): void {
    if (!this.map) return;

    const routeLayers = ['transit-routes-glow', 'transit-routes-casing', 'transit-routes-line'];
    const stationLayers = ['transit-stations-ring', 'transit-stations-circle', 'transit-stations-label'];

    if (mode === 'ALL') {
      routeLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, null));
      stationLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, null));
    } else {
      const routeFilter: any = ['==', ['get', 'mode'], mode];
      const stationFilter: any = ['==', ['get', 'primaryMode'], mode];

      routeLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, routeFilter));
      stationLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, stationFilter));
    }
  }

  /**
   * Filter transit layers by specific Line ID
   */
  filterByLine(lineId: string | null): void {
    if (!this.map) return;
    const routeLayers = ['transit-routes-glow', 'transit-routes-casing', 'transit-routes-line'];

    if (!lineId || lineId === 'ALL') {
      routeLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, null));
    } else {
      const filter: any = ['==', ['get', 'routeId'], lineId];
      routeLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, filter));
      this.fitRouteBounds(lineId);
    }
  }

  /**
   * Automatically frame camera to the geographic extent of a transit corridor
   */
  fitRouteBounds(routeId: string): void {
    if (!this.map || !this.cachedRoutesGeoJson) return;

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    let found = false;

    for (const feature of this.cachedRoutesGeoJson.features) {
      if (feature.properties?.['routeId'] === routeId && feature.geometry.type === 'LineString') {
        const coords = (feature.geometry as any).coordinates as [number, number][];
        for (const [lng, lat] of coords) {
          if (lng < minLng) minLng = lng;
          if (lat < minLat) minLat = lat;
          if (lng > maxLng) maxLng = lng;
          if (lat > maxLat) maxLat = lat;
          found = true;
        }
      }
    }

    if (found && isFinite(minLng) && isFinite(minLat)) {
      this.map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat]
        ],
        {
          padding: { top: 70, bottom: 60, left: 360, right: 380 },
          pitch: 48,
          duration: 1200
        }
      );
    }
  }

  private setup3DBuildings(): void {
    if (!this.map) return;

    try {
      const layers = this.map.getStyle()?.layers || [];
      let labelLayerId: string | undefined;

      for (const layer of layers) {
        if (layer.type === 'symbol' && layer.layout && 'text-field' in layer.layout) {
          labelLayerId = layer.id;
          break;
        }
      }

      const hasOpenMapTiles = !!this.map.getSource('openmaptiles');
      const sourceName = hasOpenMapTiles ? 'openmaptiles' : this.map.getSource('carto') ? 'carto' : undefined;

      if (!sourceName) return;

      if (this.map.getLayer('3d-buildings')) {
        this.map.removeLayer('3d-buildings');
      }

      this.map.addLayer(
        {
          id: '3d-buildings',
          source: sourceName,
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 13,
          paint: {
            'fill-extrusion-color': [
              'interpolate',
              ['linear'],
              ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
              0, '#0d1527',
              30, '#13203b',
              80, '#182b4f',
              200, '#223d6f',
              450, '#2c4f8d'
            ],
            'fill-extrusion-height': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 0,
              13.5, [
                'case',
                ['has', 'render_height'], ['get', 'render_height'],
                ['has', 'height'], ['get', 'height'],
                14
              ]
            ],
            'fill-extrusion-base': [
              'case',
              ['has', 'render_min_height'], ['get', 'render_min_height'],
              ['has', 'min_height'], ['get', 'min_height'],
              0
            ],
            'fill-extrusion-opacity': 0.88
          }
        },
        labelLayerId
      );
    } catch (e) {
      console.warn('[MapService] Could not enable 3D building layer:', e);
    }
  }

  toggle3DMode(): void {
    const current = this.is3DSubject.value;
    this.set3DMode(!current);
  }

  set3DMode(enable3D: boolean): void {
    if (!this.map) return;
    this.is3DSubject.next(enable3D);

    if (enable3D) {
      this.map.easeTo({
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING,
        duration: 900
      });
      if (this.map.getLayer('3d-buildings')) {
        this.map.setLayoutProperty('3d-buildings', 'visibility', 'visible');
      }
    } else {
      this.map.easeTo({
        pitch: 0,
        bearing: 0,
        duration: 900
      });
      if (this.map.getLayer('3d-buildings')) {
        this.map.setLayoutProperty('3d-buildings', 'visibility', 'none');
      }
    }
  }

  resetBearingAndPitch(): void {
    if (!this.map) return;
    this.map.easeTo({
      pitch: this.is3DSubject.value ? DEFAULT_PITCH : 0,
      bearing: this.is3DSubject.value ? DEFAULT_BEARING : 0,
      duration: 800
    });
  }

  flyToKualaLumpur(): void {
    this.flyTo(KL_COORDINATES, DEFAULT_ZOOM, DEFAULT_PITCH, DEFAULT_BEARING);
  }

  flyTo(
    center: [number, number],
    zoom: number = DEFAULT_ZOOM,
    pitch: number = DEFAULT_PITCH,
    bearing: number = DEFAULT_BEARING
  ): void {
    if (!this.map) return;
    this.map.flyTo({
      center,
      zoom,
      pitch,
      bearing,
      essential: true,
      duration: 1200
    });
  }

  zoomIn(): void {
    this.map?.zoomIn({ duration: 300 });
  }

  zoomOut(): void {
    this.map?.zoomOut({ duration: 300 });
  }

  resize(): void {
    this.map?.resize();
  }

  getMap(): maplibregl.Map | null {
    return this.map;
  }

  private updateCameraState(): void {
    if (!this.map) return;
    const center = this.map.getCenter();
    this.cameraStateSubject.next({
      center: [Number(center.lng.toFixed(4)), Number(center.lat.toFixed(4))],
      zoom: Number(this.map.getZoom().toFixed(1)),
      pitch: Math.round(this.map.getPitch()),
      bearing: Math.round(this.map.getBearing()),
      is3D: this.map.getPitch() > 10
    });
  }

  destroyMap(): void {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    this.isMapLoadedSubject.next(false);
  }
}
