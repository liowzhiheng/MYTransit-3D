import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.resolve(__dirname, '../public/assets/transit');

// Official data.gov.my endpoints
const RAPID_RAIL_URL = 'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl';
const KTMB_URL = 'https://api.data.gov.my/gtfs-static/ktmb';

// Official line colors and metadata
const ROUTE_META = {
  KGL: { name: 'MRT Kajang Line', shortName: 'KG', mode: 'MRT', color: '#008751', textColor: '#ffffff' },
  PYL: { name: 'MRT Putrajaya Line', shortName: 'PY', mode: 'MRT', color: '#ffcd00', textColor: '#000000' },
  KJ:  { name: 'LRT Kelana Jaya Line', shortName: 'KJ', mode: 'LRT', color: '#e31837', textColor: '#ffffff' },
  AG:  { name: 'LRT Ampang Line', shortName: 'AG', mode: 'LRT', color: '#e57200', textColor: '#ffffff' },
  PH:  { name: 'LRT Sri Petaling Line', shortName: 'SP', mode: 'LRT', color: '#76232f', textColor: '#ffffff' },
  MR:  { name: 'KL Monorail Line', shortName: 'MR', mode: 'MONORAIL', color: '#84bd00', textColor: '#ffffff' },
  BRT: { name: 'BRT Sunway Line', shortName: 'BRT', mode: 'BUS', color: '#115740', textColor: '#ffffff' },
  KC05_KB18: { name: 'KTM Batu Caves - Pulau Sebang', shortName: 'KC', mode: 'KTM', color: '#004b87', textColor: '#ffffff' },
  KA15_KD19: { name: 'KTM Tg Malim - Port Klang', shortName: 'TP', mode: 'KTM', color: '#c2185b', textColor: '#ffffff' }
};

// Simple CSV parser supporting quotes
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = [];
    let insideQuotes = false;
    let currentVal = '';

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"' || char === "'") {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        values.push(currentVal.trim().replace(/^["']|["']$/g, ''));
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
    values.push(currentVal.trim().replace(/^["']|["']$/g, ''));

    const record = {};
    for (let k = 0; k < headers.length; k++) {
      record[headers[k]] = values[k] !== undefined ? values[k] : '';
    }
    records.push(record);
  }

  return records;
}

// Distance between two coords in meters (Haversine formula)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Clean station name into title case and strip redundant prefixes
function cleanStationName(raw) {
  let name = raw.trim();
  // Strip common prefixes
  name = name.replace(/^(LRT|MRT|KTM|BRT|MRL)\s+/i, '');
  // Strip common suffixes
  name = name.replace(/\s*-\s*UOB/i, '');
  name = name.replace(/\s*\((MRL|LRT|MRT)\)/i, '');
  name = name.replace(/\s*STATION$/i, '');

  // Convert to Title Case
  return name
    .toLowerCase()
    .split(' ')
    .map(w => {
      if (['kl', 'mrt', 'lrt', 'ktm', 'brt', 'trx', 'iiu'].includes(w)) return w.toUpperCase();
      if (w.startsWith('kl')) return 'KL' + w.slice(2);
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

async function fetchZip(url, name) {
  console.log(`[GTFS Pipeline] Downloading ${name} from ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${name}: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return new AdmZip(Buffer.from(arrayBuffer));
}

async function main() {
  console.log('====================================================');
  console.log('  MYTransit 3D — Malaysian GTFS Ingestion Pipeline  ');
  console.log('====================================================');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let rapidRailZip;
  let ktmbZip;

  try {
    rapidRailZip = await fetchZip(RAPID_RAIL_URL, 'Rapid Rail KL');
  } catch (err) {
    console.error('[GTFS Pipeline] Error fetching Rapid Rail KL:', err.message);
    if (fs.existsSync(path.join(OUTPUT_DIR, 'stations.geojson'))) {
      console.warn('[GTFS Pipeline] Using existing cached transit assets.');
      return;
    }
    throw err;
  }

  try {
    ktmbZip = await fetchZip(KTMB_URL, 'KTMB');
  } catch (err) {
    console.warn('[GTFS Pipeline] Warning: Could not fetch KTMB, continuing with Rapid Rail:', err.message);
  }

  // 1. Process Rapid Rail Routes
  const railRoutesRaw = parseCSV(rapidRailZip.readAsText('routes.txt'));
  const railTripsRaw = parseCSV(rapidRailZip.readAsText('trips.txt'));
  const railShapesRaw = parseCSV(rapidRailZip.readAsText('shapes.txt'));
  const railStopsRaw = parseCSV(rapidRailZip.readAsText('stops.txt'));

  console.log(`[Rapid Rail] ${railRoutesRaw.length} routes, ${railStopsRaw.length} stops, ${railShapesRaw.length} shape points.`);

  // Map route_id -> list of shape_ids
  const routeToShapes = new Map();
  for (const trip of railTripsRaw) {
    if (!trip.route_id || !trip.shape_id) continue;
    if (!routeToShapes.has(trip.route_id)) {
      routeToShapes.set(trip.route_id, new Set());
    }
    routeToShapes.get(trip.route_id).add(trip.shape_id);
  }

  // Group shape points by shape_id
  const shapePoints = new Map();
  for (const pt of railShapesRaw) {
    const shapeId = pt.shape_id;
    if (!shapeId) continue;
    if (!shapePoints.has(shapeId)) {
      shapePoints.set(shapeId, []);
    }
    shapePoints.get(shapeId).push({
      lon: parseFloat(pt.shape_pt_lon),
      lat: parseFloat(pt.shape_pt_lat),
      seq: parseInt(pt.shape_pt_sequence, 10) || 0
    });
  }

  // Sort shape points by sequence
  for (const pts of shapePoints.values()) {
    pts.sort((a, b) => a.seq - b.seq);
  }

  // Build GeoJSON Routes FeatureCollection
  const routeFeatures = [];
  const processedRoutes = [];

  for (const route of railRoutesRaw) {
    const routeId = route.route_id;
    const meta = ROUTE_META[routeId] || {
      name: route.route_long_name || route.route_short_name || routeId,
      shortName: route.route_short_name || routeId,
      mode: (route.category || 'MRT').toUpperCase(),
      color: '#' + (route.route_color || '00f2fe'),
      textColor: '#' + (route.route_text_color || 'ffffff')
    };

    processedRoutes.push({
      id: routeId,
      name: meta.name,
      shortName: meta.shortName,
      mode: meta.mode,
      color: meta.color,
      textColor: meta.textColor,
      description: route.route_desc || ''
    });

    const shapes = routeToShapes.get(routeId);
    if (shapes) {
      for (const shapeId of shapes) {
        const pts = shapePoints.get(shapeId);
        if (pts && pts.length > 1) {
          routeFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: pts.map(p => [p.lon, p.lat])
            },
            properties: {
              routeId,
              name: meta.name,
              shortName: meta.shortName,
              mode: meta.mode,
              color: meta.color
            }
          });
        }
      }
    }
  }

  // 2. Process KTMB if available
  let ktmStopsRaw = [];
  if (ktmbZip) {
    const ktmRoutesRaw = parseCSV(ktmbZip.readAsText('routes.txt'));
    const ktmTripsRaw = parseCSV(ktmbZip.readAsText('trips.txt'));
    const ktmStopTimesRaw = parseCSV(ktmbZip.readAsText('stop_times.txt'));
    ktmStopsRaw = parseCSV(ktmbZip.readAsText('stops.txt'));

    console.log(`[KTMB] ${ktmRoutesRaw.length} routes, ${ktmStopsRaw.length} stops.`);

    // Include Klang Valley commuter lines
    for (const lineKey of ['KC05_KB18', 'KA15_KD19']) {
      const meta = ROUTE_META[lineKey];
      if (meta) {
        processedRoutes.push({
          id: lineKey,
          name: meta.name,
          shortName: meta.shortName,
          mode: meta.mode,
          color: meta.color,
          textColor: meta.textColor,
          description: 'KTM Komuter Klang Valley Sector'
        });

        // Generate track geometry from stop sequence of representative trip
        const trip = ktmTripsRaw.find(t => t.route_id === lineKey);
        if (trip) {
          const tripStopTimes = ktmStopTimesRaw
            .filter(st => st.trip_id === trip.trip_id)
            .sort((a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10));

          const stopMap = new Map(ktmStopsRaw.map(s => [s.stop_id, s]));
          const lineCoords = [];

          for (const st of tripStopTimes) {
            const stopObj = stopMap.get(st.stop_id);
            if (stopObj) {
              const lat = parseFloat(stopObj.stop_lat);
              const lon = parseFloat(stopObj.stop_lon);
              // Filter to Klang Valley / Selangor bounding box (lat: 2.7 to 3.8, lon: 101.1 to 102.0)
              if (lat >= 2.7 && lat <= 3.8 && lon >= 101.1 && lon <= 102.0) {
                lineCoords.push([lon, lat]);
              }
            }
          }

          if (lineCoords.length > 1) {
            routeFeatures.push({
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: lineCoords
              },
              properties: {
                routeId: lineKey,
                name: meta.name,
                shortName: meta.shortName,
                mode: meta.mode,
                color: meta.color
              }
            });
          }
        }
      }
    }
  }

  // 3. Normalization of Stops into Logical Transit Stations
  console.log('[GTFS Pipeline] Normalizing stations & platforms...');
  const rawStops = [];

  // Add Rapid Rail stops
  for (const s of railStopsRaw) {
    const lat = parseFloat(s.stop_lat);
    const lon = parseFloat(s.stop_lon);
    if (isNaN(lat) || isNaN(lon)) continue;

    const routeMeta = ROUTE_META[s.route_id];
    rawStops.push({
      stopId: s.stop_id,
      rawName: s.stop_name,
      cleanName: cleanStationName(s.stop_name),
      lat,
      lon,
      routeId: s.route_id,
      lineName: routeMeta?.name || s.route_id,
      mode: routeMeta?.mode || (s.category || 'MRT').toUpperCase()
    });
  }

  // Add Klang Valley KTMB stops
  for (const s of ktmStopsRaw) {
    const lat = parseFloat(s.stop_lat);
    const lon = parseFloat(s.stop_lon);
    if (isNaN(lat) || isNaN(lon)) continue;
    // Filter to Klang Valley metropolitan zone
    if (lat >= 2.9 && lat <= 3.35 && lon >= 101.4 && lon <= 101.85) {
      rawStops.push({
        stopId: s.stop_id,
        rawName: s.stop_name,
        cleanName: cleanStationName(s.stop_name),
        lat,
        lon,
        routeId: 'KTM',
        lineName: 'KTM Komuter',
        mode: 'KTM'
      });
    }
  }

  // Cluster stops by spatial proximity (<= 280 meters) and matching name
  const normalizedStations = [];
  const visited = new Set();

  for (let i = 0; i < rawStops.length; i++) {
    if (visited.has(i)) continue;
    visited.add(i);

    const base = rawStops[i];
    const cluster = [base];

    for (let j = i + 1; j < rawStops.length; j++) {
      if (visited.has(j)) continue;
      const candidate = rawStops[j];

      const dist = haversineDistance(base.lat, base.lon, candidate.lat, candidate.lon);
      const isNameMatch =
        base.cleanName === candidate.cleanName ||
        base.cleanName.includes(candidate.cleanName) ||
        candidate.cleanName.includes(base.cleanName);

      // Group into single logical station if close and names match, or if within 120m regardless
      if ((dist < 280 && isNameMatch) || dist < 100) {
        visited.add(j);
        cluster.push(candidate);
      }
    }

    // Compute centroid coordinates
    const avgLat = cluster.reduce((sum, c) => sum + c.lat, 0) / cluster.length;
    const avgLon = cluster.reduce((sum, c) => sum + c.lon, 0) / cluster.length;

    // Aggregate lines and modes
    const lines = Array.from(new Set(cluster.map(c => c.lineName)));
    const modes = Array.from(new Set(cluster.map(c => c.mode)));
    const stopIds = cluster.map(c => c.stopId);

    // Primary code (e.g. KG16, KJ14)
    const codes = cluster.map(c => c.stopId).filter(id => /^[A-Z]{1,3}\d+/i.test(id));
    const stationCode = codes.length > 0 ? Array.from(new Set(codes)).join(' / ') : undefined;

    // Pick highest priority mode for primary color
    const modePriority = ['MRT', 'LRT', 'MONORAIL', 'KTM', 'BUS'];
    modes.sort((a, b) => modePriority.indexOf(a) - modePriority.indexOf(b));
    const primaryMode = modes[0];

    const stationId = 'stn_' + base.cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    normalizedStations.push({
      id: stationId,
      name: base.cleanName,
      code: stationCode,
      latitude: Number(avgLat.toFixed(6)),
      longitude: Number(avgLon.toFixed(6)),
      lines,
      modes,
      stopIds,
      primaryMode
    });
  }

  // Sort stations alphabetically
  normalizedStations.sort((a, b) => a.name.localeCompare(b.name));

  // Build GeoJSON Stations FeatureCollection
  const stationFeatures = normalizedStations.map(stn => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [stn.longitude, stn.latitude]
    },
    properties: {
      id: stn.id,
      name: stn.name,
      code: stn.code || '',
      lines: stn.lines.join(', '),
      modes: stn.modes.join(', '),
      primaryMode: stn.primaryMode,
      color:
        stn.primaryMode === 'MRT' ? '#008751' :
        stn.primaryMode === 'LRT' ? '#e31837' :
        stn.primaryMode === 'MONORAIL' ? '#84bd00' :
        stn.primaryMode === 'KTM' ? '#004b87' : '#115740'
    }
  }));

  const routesGeoJson = {
    type: 'FeatureCollection',
    features: routeFeatures
  };

  const stationsGeoJson = {
    type: 'FeatureCollection',
    features: stationFeatures
  };

  const metadata = {
    generatedAt: new Date().toISOString(),
    source: 'Malaysia Government Open Data (data.gov.my)',
    totalRoutes: processedRoutes.length,
    totalLineSegments: routeFeatures.length,
    totalLogicalStations: normalizedStations.length,
    totalRawStops: rawStops.length
  };

  // Write output files
  fs.writeFileSync(path.join(OUTPUT_DIR, 'routes.geojson'), JSON.stringify(routesGeoJson, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'stations.geojson'), JSON.stringify(stationsGeoJson, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'routes.json'), JSON.stringify(processedRoutes, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'stations.json'), JSON.stringify(normalizedStations, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'metadata.json'), JSON.stringify(metadata, null, 2));

  console.log('----------------------------------------------------');
  console.log(`[Success] Pipeline generated:`);
  console.log(` - ${processedRoutes.length} Transit Routes`);
  console.log(` - ${routeFeatures.length} Route Geometries (GeoJSON)`);
  console.log(` - ${normalizedStations.length} Normalized Logical Stations (from ${rawStops.length} raw stops)`);
  console.log(`Assets written to: ${OUTPUT_DIR}`);
  console.log('====================================================');
}

main().catch(err => {
  console.error('[GTFS Pipeline] Fatal error:', err);
  process.exit(1);
});
