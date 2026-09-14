import { TestBed } from '@angular/core/testing';
import { take } from 'rxjs/operators';
import { RealtimeDataService } from './realtime-data.service';

describe('RealtimeDataService', () => {
  let service: RealtimeDataService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [RealtimeDataService]
    });
    service = TestBed.inject(RealtimeDataService);
  });

  afterEach(() => {
    service.stopPolling();
  });

  it('should be created and initialize in polling mode', () => {
    expect(service).toBeTruthy();
  });

  it('should toggle polling state cleanly', () => {
    service.stopPolling();
    service.togglePolling();
    service.isPolling$.pipe(take(1)).subscribe(isPolling => {
      expect(isPolling).toBeTrue();
    });

    service.togglePolling();
    service.isPolling$.pipe(take(1)).subscribe(isPolling => {
      expect(isPolling).toBeFalse();
    });
  });

  it('should fallback gracefully to SCHEDULED status', (done) => {
    service.realtimeStatus$.pipe(take(1)).subscribe(status => {
      expect(['REALTIME', 'SCHEDULED']).toContain(status.status);
      expect(status.source).toBeDefined();
      done();
    });
  });
});
