import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StationSearchComponent } from './station-search.component';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TransitDataService } from '../../core/services/transit-data.service';
import { MapService } from '../../core/services/map.service';
import { of } from 'rxjs';
import { TransitStation } from '../../core/models/transit.models';

describe('StationSearchComponent', () => {
  let component: StationSearchComponent;
  let fixture: ComponentFixture<StationSearchComponent>;
  let transitDataService: TransitDataService;

  const mockStations: TransitStation[] = [
    {
      id: 'stn_pasar-seni',
      name: 'Pasar Seni',
      code: 'KG16 / KJ14',
      latitude: 3.1424,
      longitude: 101.6961,
      lines: ['MRT Kajang Line', 'LRT Kelana Jaya Line'],
      modes: ['MRT', 'LRT'],
      stopIds: ['stop-1', 'stop-2'],
      primaryMode: 'MRT'
    },
    {
      id: 'stn_kl-sentral',
      name: 'KL Sentral',
      code: 'KJ15 / KA01',
      latitude: 3.1343,
      longitude: 101.6865,
      lines: ['LRT Kelana Jaya Line', 'KTM Komuter'],
      modes: ['LRT', 'KTM'],
      stopIds: ['stop-3'],
      primaryMode: 'LRT'
    }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StationSearchComponent],
      providers: [
        TransitDataService,
        MapService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    }).compileComponents();

    transitDataService = TestBed.inject(TransitDataService);
    // Inject mock stations
    (transitDataService as any).stationsSubject.next(mockStations);

    fixture = TestBed.createComponent(StationSearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the search component', () => {
    expect(component).toBeTruthy();
  });

  it('should match station by code query (e.g. "kg16")', (done) => {
    component.onInput({ target: { value: 'kg16' } } as any);

    setTimeout(() => {
      expect(component.results.length).toBeGreaterThan(0);
      expect(component.results[0].station.name).toBe('Pasar Seni');
      done();
    }, 150);
  });

  it('should match station by name query (e.g. "sentral")', (done) => {
    component.onInput({ target: { value: 'sentral' } } as any);

    setTimeout(() => {
      expect(component.results.length).toBeGreaterThan(0);
      expect(component.results[0].station.name).toBe('KL Sentral');
      done();
    }, 150);
  });
});
