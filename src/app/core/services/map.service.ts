import { Injectable, NgZone, inject } from '@angular/core';
import * as maplibregl from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { MapCameraState, TransitStation } from '../models/transit.models';

export const KL_COORDINATES: [number, number] = [101.6961, 3.1424]; // Kuala Lumpur Central (Pasar Seni / Merdeka)
export const DEFAULT_ZOOM = 13.5;
export const DEFAULT_PITCH = 50;
export const DEFAULT_BEARING = -15;

export const ESRI_DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    'esri-dark': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      maxzoom: 16,
      attribution:
        '© <a href="https://www.esri.com" target="_blank">Esri</a>, HERE, Garmin, © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
    },
    'esri-dark-reference': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      maxzoom: 16
    }
  },
  layers: [
    {
      id: 'esri-dark-base',
      type: 'raster',
      source: 'esri-dark',
      minzoom: 0,
      maxzoom: 20
    },
    {
      id: 'esri-dark-reference',
      type: 'raster',
      source: 'esri-dark-reference',
      minzoom: 0,
      maxzoom: 20,
      paint: {
        'raster-opacity': 0.75
      }
    }
  ]
};

// Backward compatibility alias
export const CARTO_DARK_STYLE = ESRI_DARK_STYLE;

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
  private cachedVehiclesGeoJson: FeatureCollection | null = null;
  private cachedSelectedStation: TransitStation | null = null;
  private selectedStationCoords: [number, number] | null = null;
  private hasInitializedLayers = false;

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

    this.hasInitializedLayers = false;
    this.isMapLoadedSubject.next(false);
    this.errorSubject.next(null);

    this.zone.runOutsideAngular(() => {
      try {
        const mapInstance = new maplibregl.Map({
          container,
          style: ESRI_DARK_STYLE,
          center: KL_COORDINATES,
          zoom: DEFAULT_ZOOM,
          pitch: DEFAULT_PITCH,
          bearing: DEFAULT_BEARING,
          maxPitch: 75,
          attributionControl: false
        });

        this.map = mapInstance;
        if (typeof window !== 'undefined') {
          (window as any).__map = mapInstance;
          (window as any).__mapService = this;
        }

        mapInstance.addControl(
          new maplibregl.AttributionControl({
            compact: true,
            customAttribution:
              '© <a href="https://www.esri.com" target="_blank">Esri</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> | Transit: <a href="https://data.gov.my" target="_blank">data.gov.my</a>'
          }),
          'bottom-right'
        );

        const onMapReady = () => {
          if (this.hasInitializedLayers || !this.map) return;
          this.hasInitializedLayers = true;
          this.zone.run(() => {
            this.isMapLoadedSubject.next(true);
            if (this.cachedRoutesGeoJson && this.cachedStationsGeoJson) {
              this.applyTransitLayers(this.cachedRoutesGeoJson, this.cachedStationsGeoJson);
            }
            if (this.cachedVehiclesGeoJson) {
              this.applyVehicles(this.cachedVehiclesGeoJson);
            }
            this.setup3DBuildings();
            this.updateCameraState();
            setTimeout(() => this.resize(), 100);
          });
        };

        mapInstance.on('load', onMapReady);

        // Safety fallback: Ensure digital twin renders within 1.5s regardless of external tile latency
        setTimeout(() => {
          if (!this.hasInitializedLayers && this.map) {
            console.info('[MapService] Activating transit layers via readiness timeout fallback');
            onMapReady();
          }
        }, 1500);

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

    if (this.map && (this.hasInitializedLayers || this.map.loaded())) {
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

        // Station text label (visible at zoom >= 12)
        this.map.addLayer({
          id: 'transit-stations-label',
          type: 'symbol',
          source: 'transit-stations',
          minzoom: 12,
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9.5, 14, 11, 16, 12.5],
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

      if (this.cachedSelectedStation) {
        this.highlightStation(this.cachedSelectedStation);
      }

      console.info(
        `[MapService] Mounted transit network: ${routesGeoJson.features?.length || 0} routes, ${stationsGeoJson.features?.length || 0} stations.`
      );
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
    }
  }

  highlightStation(station: TransitStation | null): void {
    this.cachedSelectedStation = station;
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
    this.cachedVehiclesGeoJson = geoJson;
    if (this.map && (this.hasInitializedLayers || this.map.loaded())) {
      this.applyVehicles(geoJson);
    }
  }

  private applyVehicles(geoJson: FeatureCollection): void {
    if (!this.map) return;

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
            'circle-radius': 14,
            'circle-color': ['coalesce', ['get', 'color'], '#10b981'],
            'circle-opacity': 0.45,
            'circle-blur': 0.8
          }
        });

        // Vehicle core dot
        this.map.addLayer({
          id: 'transit-vehicles-circle',
          type: 'circle',
          source: 'transit-vehicles',
          paint: {
            'circle-radius': 5.5,
            'circle-color': ['coalesce', ['get', 'color'], '#10b981'],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
          }
        });

        // Vehicle route badge label
        this.map.addLayer({
          id: 'transit-vehicles-label',
          type: 'symbol',
          source: 'transit-vehicles',
          minzoom: 12.5,
          layout: {
            'text-field': ['get', 'id'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 9.5,
            'text-offset': [0, -1.3],
            'text-anchor': 'bottom'
          },
          paint: {
            'text-color': ['coalesce', ['get', 'color'], '#10b981'],
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

          const lineColor = p?.['color'] || '#10b981';
          const html = `
            <div style="background:#0a111e; color:#f8fafc; padding:10px 12px; border-radius:8px; font-family:'JetBrains Mono',monospace; font-size:11px; border:1px solid ${lineColor}; min-width:210px; box-shadow:0 8px 24px rgba(0,0,0,0.6);">
              <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px;">
                <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${lineColor};"></span>
                <strong style="color:${lineColor}; font-size:12px;">${p?.['id'] || 'TRAIN'}</strong>
                <span style="margin-left:auto; font-size:9px; color:#94a3b8; background:#1e293b; padding:1px 5px; border-radius:3px;">${p?.['mode'] || 'TRANSIT'}</span>
              </div>
              <div style="margin-bottom:3px;"><span style="color:#64748b;">LINE:</span> <strong>${p?.['lineName'] || p?.['routeId'] || '--'}</strong></div>
              <div style="margin-bottom:3px;"><span style="color:#64748b;">DIRECTION:</span> ${p?.['direction'] || 'In Service'}</div>
              <div style="margin-bottom:3px;"><span style="color:#64748b;">SPEED:</span> <span style="color:#38bdf8; font-weight:600;">${p?.['speed'] ? p['speed'] + ' km/h' : p?.['status'] || '--'}</span></div>
              <div style="margin-bottom:3px;"><span style="color:#64748b;">HEADING:</span> ${p?.['bearing'] ? p['bearing'] + '°' : '--'}</div>
              <div style="margin-top:6px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.1); font-size:9px; color:#94a3b8;">
                SRC: ${p?.['source'] || 'GTFS Timetable'}
              </div>
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
   * Render or update user's live position marker with radar ripple glow
   */
  setUserLocation(coords: [number, number], accuracyMeters?: number): void {
    if (!this.map) return;

    const geojson: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: coords
          },
          properties: {
            accuracy: accuracyMeters || 20
          }
        }
      ]
    };

    try {
      const source = this.map.getSource('user-location') as maplibregl.GeoJSONSource;
      if (source) {
        source.setData(geojson);
      } else {
        this.map.addSource('user-location', {
          type: 'geojson',
          data: geojson
        });

        // Pulsating outer aura
        this.map.addLayer({
          id: 'user-location-glow',
          type: 'circle',
          source: 'user-location',
          paint: {
            'circle-radius': 22,
            'circle-color': '#0284c7',
            'circle-opacity': 0.35,
            'circle-blur': 0.8
          }
        });

        // Core cyan location dot
        this.map.addLayer({
          id: 'user-location-dot',
          type: 'circle',
          source: 'user-location',
          paint: {
            'circle-radius': 7,
            'circle-color': '#38bdf8',
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#ffffff'
          }
        });
      }
    } catch (err) {
      console.warn('[MapService] Error setting user location:', err);
    }
  }

  clearUserLocation(): void {
    if (!this.map) return;
    try {
      if (this.map.getLayer('user-location-dot')) this.map.removeLayer('user-location-dot');
      if (this.map.getLayer('user-location-glow')) this.map.removeLayer('user-location-glow');
      if (this.map.getSource('user-location')) this.map.removeSource('user-location');
    } catch {}
  }

  /**
   * Filter transit layers by Mode (MRT, LRT, MONORAIL, KTM, BUS, or ALL)
   */
  filterByMode(mode: string): void {
    if (!this.map) return;

    const routeLayers = ['transit-routes-glow', 'transit-routes-casing', 'transit-routes-line'];
    const stationLayers = ['transit-stations-ring', 'transit-stations-circle', 'transit-stations-label'];
    const vehicleLayers = ['transit-vehicles-glow', 'transit-vehicles-circle', 'transit-vehicles-label'];

    if (mode === 'ALL') {
      routeLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, null));
      stationLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, null));
      vehicleLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, null));
    } else {
      const routeFilter: any = ['==', ['get', 'mode'], mode];
      const stationFilter: any = ['==', ['get', 'primaryMode'], mode];
      const vehicleFilter: any = ['==', ['get', 'mode'], mode];

      routeLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, routeFilter));
      stationLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, stationFilter));
      vehicleLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, vehicleFilter));
    }
  }

  /**
   * Filter transit layers by specific Line ID
   */
  filterByLine(lineId: string | null): void {
    if (!this.map) return;
    const routeLayers = ['transit-routes-glow', 'transit-routes-casing', 'transit-routes-line'];
    const vehicleLayers = ['transit-vehicles-glow', 'transit-vehicles-circle', 'transit-vehicles-label'];

    if (!lineId || lineId === 'ALL') {
      routeLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, null));
      vehicleLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, null));
    } else {
      const filter: any = ['==', ['get', 'routeId'], lineId];
      routeLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, filter));
      vehicleLayers.forEach(id => this.map?.getLayer(id) && this.map.setFilter(id, filter));
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
      const containerWidth = this.map.getContainer()?.clientWidth || 1200;
      const padSide = containerWidth > 1100 ? 360 : 40;
      // Stop previous momentum/flight to prevent concurrent animation conflicts
      this.map.stop();
      this.map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat]
        ],
        {
          padding: { top: 70, bottom: 60, left: padSide, right: padSide },
          pitch: 45,
          duration: 800
        }
      );
    }
  }

  private setup3DBuildings(): void {
    if (!this.map || !this.map.isStyleLoaded()) return;

    try {
      if (!this.map.getSource('openmaptiles-buildings')) {
        this.map.addSource('openmaptiles-buildings', {
          type: 'vector',
          url: 'https://tiles.openfreemap.org/planet'
        });
      }

      if (this.map.getLayer('3d-buildings')) {
        this.map.removeLayer('3d-buildings');
      }

      const beforeLayerId = this.map.getLayer('transit-routes-glow') ? 'transit-routes-glow' : undefined;

      this.map.addLayer(
        {
          id: '3d-buildings',
          source: 'openmaptiles-buildings',
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
        beforeLayerId
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
