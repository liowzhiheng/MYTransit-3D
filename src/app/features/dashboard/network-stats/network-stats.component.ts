import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MapCameraState, NetworkStatistics } from '../../../core/models/transit.models';

@Component({
  selector: 'app-network-stats',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './network-stats.component.html',
  styleUrls: ['./network-stats.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NetworkStatsComponent {
  @Input() stats: NetworkStatistics | null = null;
  @Input() cameraState: MapCameraState | null = null;
  @Input() is3D = true;
  @Input() vehiclesCount: number | null = null;
  @Input() isRealtime = false;
}
