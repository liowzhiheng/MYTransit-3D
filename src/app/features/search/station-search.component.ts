import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransitDataService } from '../../core/services/transit-data.service';
import { MapService } from '../../core/services/map.service';
import { TransitStation } from '../../core/models/transit.models';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

export interface SearchResult {
  station: TransitStation;
  score: number;
  matchedBy: 'code' | 'name' | 'line' | 'mode';
}

@Component({
  selector: 'app-station-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './station-search.component.html',
  styleUrls: ['./station-search.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StationSearchComponent implements OnInit, OnDestroy {
  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;
  @Output() stationSelected = new EventEmitter<TransitStation>();

  private transitData = inject(TransitDataService);
  private mapService = inject(MapService);

  query = '';
  results: SearchResult[] = [];
  selectedIndex = -1;
  isOpen = false;

  private allStations: TransitStation[] = [];
  private searchSubject = new Subject<string>();
  private subs = new Subscription();

  ngOnInit(): void {
    // Cache stations for fast local in-memory search
    this.subs.add(
      this.transitData.stations$.subscribe(stations => {
        this.allStations = stations;
      })
    );

    // Debounced search stream
    this.subs.add(
      this.searchSubject.pipe(
        debounceTime(120),
        distinctUntilChanged()
      ).subscribe(q => {
        this.executeSearch(q);
      })
    );
  }

  // Global hotkeys: '/' or 'Ctrl+K' / 'Cmd+K' to focus search
  @HostListener('window:keydown', ['$event'])
  handleGlobalKeydown(e: KeyboardEvent): void {
    if (e.key === '/' && document.activeElement !== this.searchInput?.nativeElement) {
      e.preventDefault();
      this.focusSearch();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.focusSearch();
    }
  }

  onInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.query = val;
    this.searchSubject.next(val);
  }

  onKeydown(e: KeyboardEvent): void {
    if (!this.isOpen || this.results.length === 0) {
      if (e.key === 'ArrowDown') {
        this.isOpen = true;
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex =
        this.selectedIndex <= 0 ? this.results.length - 1 : this.selectedIndex - 1;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.selectedIndex >= 0 && this.selectedIndex < this.results.length) {
        this.selectResult(this.results[this.selectedIndex].station);
      } else if (this.results.length > 0) {
        this.selectResult(this.results[0].station);
      }
    } else if (e.key === 'Escape') {
      this.closeDropdown();
    }
  }

  private executeSearch(query: string): void {
    const q = query.trim().toLowerCase();
    if (!q) {
      this.results = [];
      this.isOpen = false;
      this.selectedIndex = -1;
      return;
    }

    const scored: SearchResult[] = [];

    for (const stn of this.allStations) {
      const name = stn.name.toLowerCase();
      const code = (stn.code || '').toLowerCase();
      let score = 0;
      let matchedBy: 'code' | 'name' | 'line' | 'mode' = 'name';

      // 1. Exact code match (e.g. "kg16")
      if (code === q || code.split(' / ').some(c => c.trim() === q)) {
        score = 100;
        matchedBy = 'code';
      }
      // 2. Code prefix match (e.g. "kg1")
      else if (code.includes(q)) {
        score = 80;
        matchedBy = 'code';
      }
      // 3. Exact name match
      else if (name === q) {
        score = 90;
        matchedBy = 'name';
      }
      // 4. Name prefix match
      else if (name.startsWith(q)) {
        score = 75;
        matchedBy = 'name';
      }
      // 5. Name word prefix match (e.g. "seni" matches "Pasar Seni")
      else if (name.split(' ').some(w => w.startsWith(q))) {
        score = 65;
        matchedBy = 'name';
      }
      // 6. Name substring match
      else if (name.includes(q)) {
        score = 50;
        matchedBy = 'name';
      }
      // 7. Lines match (e.g. "kajang line", "kelana")
      else if (stn.lines.some(l => l.toLowerCase().includes(q))) {
        score = 35;
        matchedBy = 'line';
      }
      // 8. Mode match (e.g. "mrt", "monorail")
      else if (stn.modes.some(m => m.toLowerCase().startsWith(q))) {
        score = 25;
        matchedBy = 'mode';
      }

      if (score > 0) {
        scored.push({ station: stn, score, matchedBy });
      }
    }

    // Sort by score descending, then by alphabetical name
    scored.sort((a, b) => b.score - a.score || a.station.name.localeCompare(b.station.name));

    this.results = scored.slice(0, 8);
    this.isOpen = this.results.length > 0;
    this.selectedIndex = this.results.length > 0 ? 0 : -1;
  }

  selectResult(station: TransitStation): void {
    this.query = station.name;
    this.closeDropdown();

    // Select station and fly camera in 3D
    this.transitData.selectStation(station);
    this.mapService.flyTo([station.longitude, station.latitude], 16.2, 58, -15);
    this.stationSelected.emit(station);

    // Update URL hash deep-link without reload
    try {
      window.history.replaceState(null, '', `#/station/${station.id}`);
    } catch {}
  }

  clearSearch(): void {
    this.query = '';
    this.results = [];
    this.isOpen = false;
    this.selectedIndex = -1;
    this.searchInput?.nativeElement.focus();
  }

  focusSearch(): void {
    this.searchInput?.nativeElement.focus();
    this.searchInput?.nativeElement.select();
    if (this.query.trim()) {
      this.isOpen = this.results.length > 0;
    }
  }

  closeDropdown(): void {
    this.isOpen = false;
    this.selectedIndex = -1;
  }

  getModeColor(mode: string): string {
    switch (mode) {
      case 'MRT': return '#008751';
      case 'LRT': return '#e31837';
      case 'MONORAIL': return '#8dc63f';
      case 'KTM': return '#004b87';
      case 'BUS': return '#00bcd4';
      default: return '#64748b';
    }
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }
}
