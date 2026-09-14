export type TransitMode = 'MRT' | 'LRT' | 'MONORAIL' | 'KTM' | 'BUS';

export type TransitDataStatus =
  | 'REALTIME'
  | 'SCHEDULED'
  | 'ESTIMATED'
  | 'UNAVAILABLE'
  | 'ERROR';

export type NetworkOperationalStatus =
  | 'OPERATIONAL'
  | 'DEGRADED'
  | 'DISRUPTED'
  | 'MAINTENANCE';

export interface TransitRoute {
  id: string;
  name: string;
  shortName?: string;
  color?: string;
  textColor?: string;
  mode: TransitMode;
  description?: string;
}

export interface TransitStation {
  id: string;
  name: string;
  code?: string;
  latitude: number;
  longitude: number;
  lines: string[];
  modes: TransitMode[];
  stopIds: string[];
  primaryMode?: TransitMode;
  operationalStatus?: NetworkOperationalStatus;
  nextServiceMinutes?: number;
  nextServiceMode?: 'REALTIME' | 'SCHEDULED';
}

export interface TransitVehicle {
  id: string;
  routeId?: string;
  latitude: number;
  longitude: number;
  bearing?: number;
  status?: string;
  timestamp?: string;
  source: string;
}

export interface TransitAlert {
  id: string;
  title: string;
  description?: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  routeId?: string;
  stationId?: string;
}

export interface TransitStatus {
  status: TransitDataStatus;
  lastUpdated?: string;
  source?: string;
  message?: string;
}

export interface NetworkStatistics {
  activeLines: number;
  totalStations: number;
  activeVehicles: number | null;
  networkStatus: NetworkOperationalStatus;
  dataSource: string;
  lastUpdated: string;
}

export interface MapCameraState {
  center: [number, number]; // [longitude, latitude]
  zoom: number;
  pitch: number;
  bearing: number;
  is3D: boolean;
}
