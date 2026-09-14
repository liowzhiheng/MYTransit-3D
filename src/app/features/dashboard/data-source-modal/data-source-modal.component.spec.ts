import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DataSourceModalComponent } from './data-source-modal.component';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TransitDataService } from '../../../core/services/transit-data.service';

describe('DataSourceModalComponent', () => {
  let component: DataSourceModalComponent;
  let fixture: ComponentFixture<DataSourceModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataSourceModalComponent],
      providers: [
        TransitDataService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DataSourceModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the modal component', () => {
    expect(component).toBeTruthy();
  });

  it('should emit closeModal when backdrop is clicked', () => {
    spyOn(component.closeModal, 'emit');
    const mockEvent = {
      target: {
        classList: {
          contains: (cls: string) => cls === 'modal-backdrop'
        }
      }
    } as any;

    component.onBackdropClick(mockEvent);
    expect(component.closeModal.emit).toHaveBeenCalled();
  });
});
