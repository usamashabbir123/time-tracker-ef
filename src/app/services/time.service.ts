import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from './auth.service';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class TimeService {
  // apiBase should be the backend root URL (e.g., 'http://localhost:3000')
  private apiUrl = `${environment.apiBase}/api/time-entries`;

  constructor(private http: HttpClient, private auth: AuthService) {}

  private getHeaders() {
    return {
      headers: new HttpHeaders({
        Authorization: `Bearer ${this.auth.getToken()}`
      })
    };
  }

  getTimeEntries(): Observable<any> {
    return this.http.get(this.apiUrl, this.getHeaders());
  }

  createTimeEntry(projectId: number, startTime: string, endTime: string): Observable<any> {
    return this.http.post(
      this.apiUrl,
      { projectId, startTime, endTime },
      this.getHeaders()
    );
  }

  approveTimeEntry(entryId: number): Observable<any> {
    return this.http.put(`${this.apiUrl}/${entryId}/approve`, {}, this.getHeaders());
  }

  rejectTimeEntry(entryId: number): Observable<any> {
    return this.http.put(`${this.apiUrl}/${entryId}/reject`, {}, this.getHeaders());
  }
}
