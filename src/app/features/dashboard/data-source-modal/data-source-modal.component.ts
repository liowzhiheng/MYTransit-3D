import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TransitDataService } from '../../../core/services/transit-data.service';

@Component({
  selector: 'app-data-source-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './data-source-modal.component.html',
  styleUrls: ['./data-source-modal.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DataSourceModalComponent {
  @Input() isOpen = false;
  @Output() closeModal = new EventEmitter<void>();

  private transitData = inject(TransitDataService);

  readonly metadata$ = this.transitData.metadata$;

  onBackdropClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-backdrop')) {
      this.closeModal.emit();
    }
  }
}
