import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TransitDataService } from './transit-data.service';

describe('TransitDataService', () => {
  let service: TransitDataService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TransitDataService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(TransitDataService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should toggle mode and line filters', () => {
    service.setModeFilter('MRT');
    expect(service.getActiveModeFilter()).toBe('MRT');

    service.setLineFilter('KGL');
    expect(service.getActiveLineFilter()).toBe('KGL');

    service.setLineFilter(null);
    expect(service.getActiveLineFilter()).toBeNull();
  });
});
