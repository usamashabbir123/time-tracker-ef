import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { AdminService } from '../../services/admin.service';
import { AuthService } from '../../services/auth.service';
import { ToastNotificationService } from '../../services/toast-notification.service';

interface WeekDay {
  date: Date;
  dayName: string;
  dayNumber: number;
  monthName: string;
  isToday: boolean;
}

interface ActivityRow {
  taskName: string;
  description: string;
  projectName: string;
  projectId?: number; // Add projectId to look up tasks
  allocatedTime?: string; // Allocated time in HH:MM:SS format
  allocatedTimeSeconds?: number; // Allocated time in seconds for comparison
  timeExceeded?: boolean; // Flag to indicate if time exceeded allocated time
  dailyTime: { [key: string]: number }; // Key: YYYY-MM-DD, Value: seconds
  totalTime: number; // Total time in seconds
  users: { [key: string]: { name: string; email: string; time: number } }; // Key: user_id, Value: { name, email, time in seconds }
  userList: string[]; // List of user names who worked on this task
}

@Component({
  selector: 'app-timesheet',
  templateUrl: './timesheet.component.html',
  styleUrls: ['./timesheet.component.scss']
})
export class TimesheetComponent implements OnInit, OnDestroy {
  timeEntries: any[] = [];
  projects: any[] = [];
  activeEntry: any = null;
  selectedProjectId: number | null = null;
  selectedTaskId: number | null = null;
  projectTasks: { [key: number]: any[] } = {};
  description: string = '';
  isEmployee: boolean = false;
  isAdmin: boolean = false;
  
  // Week view properties
  currentWeekStart: Date = new Date();
  weekDays: WeekDay[] = [];
  activityRows: ActivityRow[] = [];
  selectedView: 'day' | 'week' | 'month' = 'week';
  timerInterval: any = null;
  elapsedTime: number = 0; // in seconds
  
  // Admin edit properties
  editingEntryId: number | null = null;
  editEntryData: any = {};
  
  // Inline time cell editing
  editingCell: { activityKey: string; dateKey: string } | null = null;
  editingCellTime: string = ''; // Time in HH:MM format
  
  // Individual activity timers
  activeActivityTimers: { [key: string]: { startTime: Date; elapsedTime: number; interval: any } } = {};
  
  // Add line properties
  showAddLineForm: boolean = false;
  isModalMaximized: boolean = false;
  newTimeEntry: any = {
    project_id: null,
    date: '',
    task_name: '',
    task_id: null, // Add task_id for dropdown selection
    time_spent: '00:00',
    description: ''
  };
  users: any[] = [];
  showCreateTaskInput: boolean = false;
  newTaskTitle: string = '';
  
  // Search and filter properties
  searchTerm: string = '';
  showSearchDropdown: boolean = false;
  showSearchSuggestions: boolean = false;
  activeFilters: string[] = [];
  selectedSearchOption: string = '';
  selectedProjectFilter: number | null = null;
  showProjectFilter: boolean = false;
  filteredTimeEntries: any[] = [];

  constructor(
    private adminService: AdminService,
    private authService: AuthService,
    private toastService: ToastNotificationService
  ) {}

  ngOnInit(): void {
    const role = this.authService.getRole();
    this.isEmployee = role?.toLowerCase() === 'employee';
    this.isAdmin = role?.toLowerCase() === 'admin';
    
    this.initializeWeek();
    this.loadTimeEntries();
    this.loadProjects(); // Load projects for all roles
    this.loadActiveTimeEntry(); // Load active entry for all roles
    this.startTimer();
    
    // Load users for add line functionality (all users can add lines)
    this.loadUsers();
  }

  ngOnDestroy(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    this.stopAllActivityTimers();
  }

  initializeWeek() {
    const today = new Date();
    
    if (this.selectedView === 'day') {
      this.currentWeekStart = new Date(today);
    } else if (this.selectedView === 'week') {
      // Set current week start to Monday of current week
      const day = today.getDay();
      const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
      this.currentWeekStart = new Date(today.setDate(diff));
    } else if (this.selectedView === 'month') {
      // Set to first day of current month
      this.currentWeekStart = new Date(today.getFullYear(), today.getMonth(), 1);
    }
    
    this.currentWeekStart.setHours(0, 0, 0, 0);
    this.updateWeekDays();
  }

  updateWeekDays() {
    this.weekDays = [];
    let startDate = new Date(this.currentWeekStart);
    
    let daysToShow = 7; // Default for week view
    
    if (this.selectedView === 'day') {
      daysToShow = 1;
    } else if (this.selectedView === 'week') {
      daysToShow = 7;
    } else if (this.selectedView === 'month') {
      // Get number of days in month
      const lastDay = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
      const daysInMonth = lastDay.getDate();
      
      // Start from first day of month
      startDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      daysToShow = daysInMonth;
    }
    
    for (let i = 0; i < daysToShow; i++) {
      let date: Date;
      if (this.selectedView === 'day') {
        date = new Date(startDate);
      } else if (this.selectedView === 'week') {
        date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
      } else if (this.selectedView === 'month') {
        // Create date for specific day in the month
        date = new Date(startDate.getFullYear(), startDate.getMonth(), i + 1);
      } else {
        date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
      }
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const checkDate = new Date(date);
      checkDate.setHours(0, 0, 0, 0);
      
      this.weekDays.push({
        date: date,
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNumber: date.getDate(),
        monthName: date.toLocaleDateString('en-US', { month: 'short' }),
        isToday: checkDate.getTime() === today.getTime()
      });
    }
    
    this.processTimeEntries();
  }

  processTimeEntries() {
    // Group time entries by task/activity
    const activityMap = new Map<string, ActivityRow>();
    
    // Ensure weekDays is initialized
    if (!this.weekDays || this.weekDays.length === 0) {
      this.updateWeekDays();
      return;
    }
    
    // Apply filters to time entries
    let filteredEntries = this.timeEntries;
    
    // Apply search filter
    if (this.searchTerm && this.searchTerm.trim() !== '') {
      const searchLower = this.searchTerm.toLowerCase().trim();
      filteredEntries = filteredEntries.filter(entry => {
        if (this.selectedSearchOption === 'activity' || !this.selectedSearchOption) {
          const taskName = (entry.task_name || '').toLowerCase();
          if (taskName.includes(searchLower)) return true;
        }
        if (this.selectedSearchOption === 'project' || !this.selectedSearchOption) {
          const projectName = (entry.project_name || '').toLowerCase();
          if (projectName.includes(searchLower)) return true;
        }
        if (this.selectedSearchOption === 'description' || !this.selectedSearchOption) {
          const description = (entry.description || '').toLowerCase();
          if (description.includes(searchLower)) return true;
        }
        return false;
      });
    }
    
    // Apply project filter
    if (this.selectedProjectFilter !== null) {
      filteredEntries = filteredEntries.filter(entry => entry.project_id === this.selectedProjectFilter);
    }
    
    // Apply my-entries filter
    if (this.activeFilters.includes('my-entries')) {
      const currentUserId = this.authService.getUserId();
      filteredEntries = filteredEntries.filter(entry => entry.user_id === currentUserId);
    }
    
    filteredEntries.forEach(entry => {
      // Only process entries that have been completed (have end_time)
      if (!entry.end_time) return; // Skip active entries
      
      // Create unique key combining project and task to show all details separately
      const projectName = entry.project_name || 'Unknown Project';
      const taskName = entry.task_name || 'Unnamed Task';
      const taskKey = `${projectName} - ${taskName}`;
      
      const entryDate = new Date(entry.start_time);
      const userId = entry.user_id;
      const userName = entry.employee_name || entry.employee_email || 'Unknown User';
      const userEmail = entry.employee_email || 'Unknown User';
      
      // Check if date is valid
      if (isNaN(entryDate.getTime())) {
        console.warn('Invalid start_time date:', entry.start_time);
        return;
      }
      
      const dateKey = this.formatDateKey(entryDate);
      
      // Check if this entry falls within current view period (day/week/month)
      if (this.weekDays.length === 0) {
        return;
      }
      
      const viewStart = new Date(this.weekDays[0].date);
      viewStart.setHours(0, 0, 0, 0);
      const viewEnd = new Date(this.weekDays[this.weekDays.length - 1].date);
      viewEnd.setHours(23, 59, 59, 999);
      
      // Normalize entry date for comparison
      const normalizedEntryDate = new Date(entryDate);
      normalizedEntryDate.setHours(0, 0, 0, 0);
      
      if (normalizedEntryDate >= viewStart && normalizedEntryDate <= viewEnd) {
        if (!activityMap.has(taskKey)) {
          // Find project to get project_id
          const project = this.projects.find(p => p.name === projectName);
          const projectId = project ? project.id : entry.project_id;
          
          // Find task allocated_time
          let allocatedTime: string | undefined = undefined;
          let allocatedTimeSeconds: number = 0;
          if (projectId && this.projectTasks[projectId]) {
            const task = this.projectTasks[projectId].find((t: any) => t.title === taskName);
            if (task && task.allocated_time) {
              allocatedTime = task.allocated_time;
              if (allocatedTime) {
                allocatedTimeSeconds = this.timeToSeconds(allocatedTime);
              }
            }
          }
          
          activityMap.set(taskKey, {
            taskName: taskName,
            description: entry.description || '',
            projectName: projectName,
            projectId: projectId,
            allocatedTime: allocatedTime,
            allocatedTimeSeconds: allocatedTimeSeconds,
            timeExceeded: false,
            dailyTime: {},
            totalTime: 0,
            users: {},
            userList: []
          });
        }
        
        const activity = activityMap.get(taskKey)!;
        
        // Calculate time in seconds from start_time and end_time
        let seconds = 0;
        if (entry.start_time && entry.end_time) {
          const start = new Date(entry.start_time);
          const end = new Date(entry.end_time);
          
          if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            const diffMs = end.getTime() - start.getTime();
            seconds = Math.floor(diffMs / 1000); // Convert to seconds
            
            // If total_time exists and is in minutes, use it as fallback
            // But prefer calculated time from start/end for accuracy
            if (entry.total_time && seconds === 0) {
              // total_time is stored in minutes, convert to seconds
              seconds = entry.total_time * 60;
            }
          } else {
            // Fallback: use total_time if available (convert minutes to seconds)
            if (entry.total_time) {
              seconds = entry.total_time * 60;
            }
          }
        } else if (entry.total_time) {
          // Fallback: use total_time if start/end times not available (convert minutes to seconds)
          seconds = entry.total_time * 60;
        }
        
        // Track user time
        const userKey = userId ? String(userId) : userEmail;
        if (!activity.users[userKey]) {
          activity.users[userKey] = { name: userName, email: userEmail, time: 0 };
        }
        activity.users[userKey].time += seconds;
        
        // Always add to activity, even if seconds is 0
        if (!activity.dailyTime[dateKey]) {
          activity.dailyTime[dateKey] = 0;
        }
        activity.dailyTime[dateKey] += seconds;
        activity.totalTime += seconds;
      }
    });
    
    // Build user list for each activity and check if time exceeded
    this.activityRows = Array.from(activityMap.values()).map(activity => {
      activity.userList = Object.values(activity.users).map(u => u.name || u.email);
      
      // Check if total time exceeded allocated time
      if (activity.allocatedTimeSeconds && activity.allocatedTimeSeconds > 0) {
        activity.timeExceeded = activity.totalTime > activity.allocatedTimeSeconds;
      }
      
      return activity;
    });
  }

  formatDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  getTimeForDay(activity: ActivityRow, day: WeekDay): number {
    const dateKey = this.formatDateKey(day.date);
    return activity.dailyTime[dateKey] || 0; // Returns seconds
  }

  getTotalForDay(day: WeekDay): number {
    let total = 0;
    this.activityRows.forEach(activity => {
      total += this.getTimeForDay(activity, day);
    });
    return total; // Returns seconds
  }

  getGrandTotal(): number {
    return this.activityRows.reduce((sum, activity) => sum + activity.totalTime, 0); // Returns seconds
  }

  navigateWeek(direction: number) {
    const newDate = new Date(this.currentWeekStart);
    newDate.setDate(newDate.getDate() + (direction * 7));
    this.currentWeekStart = newDate;
    this.updateWeekDays();
    this.loadTimeEntries();
  }

  goToToday() {
    const today = new Date();
    
    if (this.selectedView === 'day') {
      this.currentWeekStart = new Date(today);
    } else if (this.selectedView === 'week') {
      const day = today.getDay();
      const diff = today.getDate() - day + (day === 0 ? -6 : 1);
      this.currentWeekStart = new Date(today.setDate(diff));
    } else if (this.selectedView === 'month') {
      this.currentWeekStart = new Date(today.getFullYear(), today.getMonth(), 1);
    }
    
    this.currentWeekStart.setHours(0, 0, 0, 0);
    this.updateWeekDays();
    this.loadTimeEntries();
  }

  startTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    if (this.activeEntry) {
      const startTime = new Date(this.activeEntry.start_time);
      const updateTimer = () => {
        const now = new Date();
        this.elapsedTime = Math.floor((now.getTime() - startTime.getTime()) / 1000);
      };
      updateTimer();
      this.timerInterval = setInterval(updateTimer, 1000);
    } else {
      this.elapsedTime = 0;
    }
  }

  formatTimer(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  formatTime(seconds: number): string {
    // Accepts seconds and formats as HH:MM:SS
    if (!seconds || seconds === 0) return '0:00:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  formatAllocatedTime(allocatedTime: any): string {
    if (!allocatedTime) return '-';
    
    // If it's already in HH:MM:SS format, return as is
    if (typeof allocatedTime === 'string' && allocatedTime.includes(':')) {
      return allocatedTime;
    }
    
    // If it's a number (decimal hours), convert to HH:MM:SS
    if (typeof allocatedTime === 'number') {
      const totalSeconds = Math.round(allocatedTime * 3600);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    return allocatedTime ? String(allocatedTime) : '-';
  }

  // Convert HH:MM:SS to total seconds
  timeToSeconds(timeStr: string): number {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const parts = timeStr.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0]) || 0;
      const minutes = parseInt(parts[1]) || 0;
      const seconds = parseInt(parts[2]) || 0;
      return hours * 3600 + minutes * 60 + seconds;
    } else if (parts.length === 2) {
      const hours = parseInt(parts[0]) || 0;
      const minutes = parseInt(parts[1]) || 0;
      return hours * 3600 + minutes * 60;
    }
    return 0;
  }

  formatTimeHHMM(seconds: number): string {
    // Formats as HH:MM (for editing)
    if (!seconds || seconds === 0) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    return `${hours}:${String(minutes).padStart(2, '0')}`;
  }

  parseTimeHHMM(timeStr: string): number {
    // Converts HH:MM format to seconds
    if (!timeStr || timeStr.trim() === '') return 0;
    
    const parts = timeStr.trim().split(':');
    if (parts.length !== 2) return 0;
    
    const hours = parseInt(parts[0]) || 0;
    const minutes = parseInt(parts[1]) || 0;
    
    return (hours * 3600) + (minutes * 60);
  }

  // Inline cell editing methods
  isCellEditing(activity: ActivityRow, day: WeekDay): boolean {
    if (!this.editingCell) return false;
    const activityKey = `${activity.projectName} - ${activity.taskName}`;
    const dateKey = this.formatDateKey(day.date);
    return this.editingCell.activityKey === activityKey && this.editingCell.dateKey === dateKey;
  }

  startEditingCell(activity: ActivityRow, day: WeekDay) {
    const activityKey = `${activity.projectName} - ${activity.taskName}`;
    const dateKey = this.formatDateKey(day.date);
    const currentTime = this.getTimeForDay(activity, day);
    
    this.editingCell = { activityKey, dateKey };
    this.editingCellTime = this.formatTimeHHMM(currentTime);
  }

  cancelCellEdit() {
    this.editingCell = null;
    this.editingCellTime = '';
  }

  saveCellTime(activity: ActivityRow, day: WeekDay) {
    if (!this.editingCell) return;
    
    const timeInSeconds = this.parseTimeHHMM(this.editingCellTime);
    const dateKey = this.formatDateKey(day.date);
    
    // Find all time entries for this activity and day
    const entriesForDay = this.timeEntries.filter(entry => {
      if (!entry.end_time) return false; // Skip active entries
      
      const projectName = entry.project_name || 'Unknown Project';
      const taskName = entry.task_name || 'Unnamed Task';
      const activityKey = `${projectName} - ${taskName}`;
      const entryDateKey = this.formatDateKey(new Date(entry.start_time));
      
      return activityKey === this.editingCell!.activityKey && entryDateKey === dateKey;
    });
    
    if (entriesForDay.length === 0) {
      // No entry exists, create a new one
      this.createTimeEntryForCell(activity, day, timeInSeconds);
    } else {
      // Update existing entries
      const totalCurrentTime = entriesForDay.reduce((sum, entry) => {
        return sum + this.getEntryTime(entry);
      }, 0);
      
      const timeDifference = timeInSeconds - totalCurrentTime;
      
      if (timeDifference === 0) {
        // No change needed
        this.cancelCellEdit();
        return;
      }
      
      if (timeDifference > 0) {
        // Need to add time - extend the last entry or create new
        this.adjustTimeEntry(entriesForDay, timeDifference, activity, day);
      } else {
        // Need to reduce time - adjust entries
        this.adjustTimeEntry(entriesForDay, timeDifference, activity, day);
      }
    }
    
    this.cancelCellEdit();
    // Reload to reflect changes
    setTimeout(() => {
      this.loadTimeEntries();
    }, 300);
  }

  createTimeEntryForCell(activity: ActivityRow, day: WeekDay, timeInSeconds: number) {
    if (timeInSeconds <= 0) {
      this.cancelCellEdit();
      return;
    }
    
    // Find project
    const project = this.projects.find(p => p.name === activity.projectName);
    if (!project) {
      alert('Project not found: ' + activity.projectName);
      this.cancelCellEdit();
      return;
    }
    
    // task_name is just a string field, doesn't need to exist in tasks table
    const dayDate = new Date(day.date);
    dayDate.setHours(9, 0, 0, 0); // Set to 9 AM
    const startTime = dayDate.toISOString();
    
    const endTime = new Date(dayDate.getTime() + (timeInSeconds * 1000)).toISOString();
    
    const currentUserId = this.authService.getUserId();
    if (!currentUserId) {
      alert('User not found');
      this.cancelCellEdit();
      return;
    }
    
    const entryData = {
      user_id: currentUserId,
      project_id: project.id,
      task_name: activity.taskName,
      description: activity.description || '',
      start_time: startTime,
      end_time: endTime
    };
    
    this.adminService.createTimeEntry(entryData).subscribe({
      next: () => {
        this.loadTimeEntries();
      },
      error: (err) => {
        alert('Error creating time entry: ' + (err.error?.message || 'Unknown error'));
        this.cancelCellEdit();
      }
    });
  }

  adjustTimeEntry(entries: any[], timeDifference: number, activity: ActivityRow, day: WeekDay) {
    if (entries.length === 0) return;
    
    // Sort entries by start_time
    entries.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    
    if (timeDifference > 0) {
      // Add time - extend the last entry
      const lastEntry = entries[entries.length - 1];
      const currentEndTime = new Date(lastEntry.end_time);
      const newEndTime = new Date(currentEndTime.getTime() + (timeDifference * 1000));
      
      this.adminService.updateTimeEntry(lastEntry.id, {
        end_time: newEndTime.toISOString()
      }).subscribe({
        next: () => {
          this.loadTimeEntries();
        },
        error: (err) => {
          alert('Error updating time entry: ' + (err.error?.message || 'Unknown error'));
        }
      });
    } else {
      // Reduce time - adjust entries proportionally or delete if needed
      const totalTime = entries.reduce((sum, entry) => sum + this.getEntryTime(entry), 0);
      const newTotalTime = totalTime + timeDifference; // timeDifference is negative
      
      if (newTotalTime <= 0) {
        // Delete all entries
        entries.forEach(entry => {
          this.adminService.deleteTimeEntry(entry.id).subscribe({
            next: () => {
              this.loadTimeEntries();
            },
            error: (err) => {
              console.error('Error deleting entry:', err);
            }
          });
        });
      } else {
        // Adjust the last entry
        const lastEntry = entries[entries.length - 1];
        const currentStartTime = new Date(lastEntry.start_time);
        const newEndTime = new Date(currentStartTime.getTime() + (newTotalTime * 1000));
        
        this.adminService.updateTimeEntry(lastEntry.id, {
          end_time: newEndTime.toISOString()
        }).subscribe({
          next: () => {
            this.loadTimeEntries();
          },
          error: (err) => {
            alert('Error updating time entry: ' + (err.error?.message || 'Unknown error'));
          }
        });
      }
    }
  }

  loadTimeEntries() {
    this.adminService.getTimeEntries().subscribe({
      next: (entries) => {
        this.timeEntries = entries || [];
        
        // Load tasks for all projects that have time entries
        const projectIds = new Set<number>();
        entries.forEach((entry: any) => {
          if (entry.project_id) {
            projectIds.add(entry.project_id);
          }
        });
        
        // Load tasks for each project
        let tasksLoadedCount = 0;
        const totalProjects = projectIds.size;
        
        if (totalProjects === 0) {
          // No projects, just process entries
          if (this.weekDays && this.weekDays.length > 0) {
            this.processTimeEntries();
          } else {
            this.updateWeekDays();
          }
          if (this.activeEntry) {
            this.startTimer();
          }
          return;
        }
        
        projectIds.forEach(projectId => {
          if (!this.projectTasks[projectId]) {
            this.adminService.getTasks(projectId).subscribe({
              next: (tasks) => {
                if (tasks && Array.isArray(tasks)) {
                  this.projectTasks[projectId] = tasks;
                }
                tasksLoadedCount++;
                // When all tasks are loaded, process entries
                if (tasksLoadedCount === totalProjects) {
                  if (this.weekDays && this.weekDays.length > 0) {
                    this.processTimeEntries();
                  } else {
                    this.updateWeekDays();
                  }
                  if (this.activeEntry) {
                    this.startTimer();
                  }
                }
              },
              error: (err) => {
                console.error(`Error loading tasks for project ${projectId}:`, err);
                tasksLoadedCount++;
                if (tasksLoadedCount === totalProjects) {
                  if (this.weekDays && this.weekDays.length > 0) {
                    this.processTimeEntries();
                  } else {
                    this.updateWeekDays();
                  }
                  if (this.activeEntry) {
                    this.startTimer();
                  }
                }
              }
            });
          } else {
            // Tasks already loaded for this project
            tasksLoadedCount++;
            if (tasksLoadedCount === totalProjects) {
              if (this.weekDays && this.weekDays.length > 0) {
                this.processTimeEntries();
              } else {
                this.updateWeekDays();
              }
              if (this.activeEntry) {
                this.startTimer();
              }
            }
          }
        });
      },
      error: (err) => {
        console.error('Error loading time entries:', err);
        this.timeEntries = [];
      }
    });
  }

  loadProjects() {
    // Load projects for all roles
    this.adminService.getProjects().subscribe({
      next: (projects) => {
        this.projects = projects;
      },
      error: (err) => {
        console.error('Error loading projects:', err);
      }
    });
  }

  onProjectChange() {
    // Reset task selection when project changes
    this.selectedTaskId = null;
    this.projectTasks = {};
    
    // Load tasks for the selected project
    if (this.selectedProjectId) {
      this.adminService.getTasks(this.selectedProjectId).subscribe({
        next: (tasks) => {
          // Ensure tasks array exists and has items
          if (tasks && Array.isArray(tasks)) {
            this.projectTasks[this.selectedProjectId!] = tasks;
            console.log('Tasks loaded for project:', this.selectedProjectId, tasks);
          } else {
            this.projectTasks[this.selectedProjectId!] = [];
            console.warn('No tasks returned for project:', this.selectedProjectId);
          }
        },
        error: (err) => {
          console.error('Error loading tasks:', err);
          this.projectTasks[this.selectedProjectId!] = [];
        }
      });
    }
  }

  loadActiveTimeEntry() {
    // Load active time entry for all roles
    this.adminService.getActiveTimeEntry().subscribe({
      next: (response) => {
        if (response.success && response.activeEntry) {
          this.activeEntry = response.activeEntry;
          this.startTimer();
          
          // Sync with activity timer if it matches
          const project = this.projects.find(p => p.id === response.activeEntry.project_id);
          if (project && response.activeEntry.task_name) {
            const key = `${project.name} - ${response.activeEntry.task_name}`;
            if (!this.activeActivityTimers[key]) {
              // Start activity timer if not already started
              const startTime = new Date(response.activeEntry.start_time);
              this.activeActivityTimers[key] = {
                startTime: startTime,
                elapsedTime: 0,
                interval: null
              };
              
              this.activeActivityTimers[key].interval = setInterval(() => {
                if (this.activeActivityTimers[key]) {
                  const now = new Date();
                  this.activeActivityTimers[key].elapsedTime = Math.floor((now.getTime() - startTime.getTime()) / 1000);
                }
              }, 1000);
            }
          }
        } else {
          this.activeEntry = null;
          if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
          }
          this.elapsedTime = 0;
          this.stopAllActivityTimers();
        }
      },
      error: (err) => {
        console.error('Error loading active time entry:', err);
        this.activeEntry = null;
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
        this.elapsedTime = 0;
        this.stopAllActivityTimers();
      }
    });
  }

  startTime() {
    if (!this.selectedProjectId) {
      alert('Please select a project');
      return;
    }

    if (!this.selectedTaskId) {
      alert('Please select a task');
      return;
    }

    // Convert selectedTaskId to number (select dropdowns return strings)
    const taskId = typeof this.selectedTaskId === 'string' ? parseInt(this.selectedTaskId, 10) : this.selectedTaskId;
    
    if (isNaN(taskId)) {
      alert('Invalid task selected');
      return;
    }

    // Get task name from selected task
    const projectTasksList = this.projectTasks[this.selectedProjectId];
    if (!projectTasksList || projectTasksList.length === 0) {
      alert('Tasks not loaded for this project. Please wait a moment and try again.');
      return;
    }

    const selectedTask = projectTasksList.find(t => t.id === taskId || t.id === this.selectedTaskId);
    if (!selectedTask) {
      console.error('Task not found. Selected Task ID:', this.selectedTaskId, 'Available tasks:', projectTasksList);
      alert('Selected task not found. Please select a task from the dropdown.');
      return;
    }

    const taskName = selectedTask.title;

    this.adminService.startTime(this.selectedProjectId, taskName, this.description?.trim() || undefined).subscribe({
      next: (response) => {
        if (response.success) {
          alert('Time tracking started successfully');
          this.selectedProjectId = null;
          this.selectedTaskId = null;
          this.projectTasks = {};
          this.description = '';
          this.loadActiveTimeEntry();
          this.loadTimeEntries();
        }
      },
      error: (err) => {
        alert('Error starting time tracking: ' + (err.error?.message || 'Unknown error'));
      }
    });
  }

  stopTime() {
    if (!this.activeEntry || !this.activeEntry.id) {
      alert('No active time entry found');
      return;
    }

    if (confirm('Stop time tracking?')) {
      this.adminService.stopTime(this.activeEntry.id).subscribe({
        next: (response) => {
          if (response.success) {
            // Clear active entry first
            this.activeEntry = null;
            if (this.timerInterval) {
              clearInterval(this.timerInterval);
              this.timerInterval = null;
            }
            this.elapsedTime = 0;
            
            // Reload entries immediately and again after a short delay to ensure backend has updated
            this.loadTimeEntries();
            setTimeout(() => {
              this.loadTimeEntries();
            }, 500);
          }
        },
        error: (err) => {
          alert('Error stopping time tracking: ' + (err.error?.message || 'Unknown error'));
        }
      });
    }
  }

  // Format datetime for display (e.g., "Jan 15, 2024 10:30 AM")
  formatDateTime(dateTimeStr: string): string {
    if (!dateTimeStr) return '-';
    
    const date = new Date(dateTimeStr);
    if (isNaN(date.getTime())) return dateTimeStr; // Return original if invalid
    
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12
    const minutesStr = minutes < 10 ? '0' + minutes : minutes;
    
    return `${month} ${day}, ${year} ${hours}:${minutesStr} ${ampm}`;
  }

  // Format total time (minutes) to hours and minutes
  formatTotalTime(minutes: number | null): string {
    if (!minutes) return '-';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  }

  discardTime() {
    if (!this.activeEntry) return;
    if (confirm('Discard current time entry?')) {
      // Stop the timer without saving
      this.activeEntry = null;
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
      this.elapsedTime = 0;
      this.loadTimeEntries();
    }
  }

  getUserKey(activity: ActivityRow, userEmail: string): string {
    // Find the key for a user email in the users object
    for (const key in activity.users) {
      if (activity.users[key].email === userEmail) {
        return key;
      }
    }
    return userEmail; // Fallback to email if not found
  }

  getUserTimeForName(activity: ActivityRow, userName: string): number {
    // Find the user time by matching name (or email as fallback)
    for (const key in activity.users) {
      const user = activity.users[key];
      if (user.name === userName || user.email === userName) {
        return user.time || 0;
      }
    }
    return 0;
  }

  // Admin functions
  clearAllTimeEntries() {
    if (!this.isAdmin) return;
    
    if (!confirm('Are you sure you want to clear ALL time entries? This action cannot be undone.')) {
      return;
    }
    
    this.adminService.clearAllTimeEntries().subscribe({
      next: (response) => {
        alert((response as any).message || 'All time entries cleared successfully');
        this.loadTimeEntries();
      },
      error: (err) => {
        alert('Error clearing time entries: ' + (err.error?.message || 'Unknown error'));
      }
    });
  }

  editTimeEntry(entry: any) {
    if (!this.isAdmin) return;
    
    this.editingEntryId = entry.id;
    this.editEntryData = {
      start_time: entry.start_time ? new Date(entry.start_time).toISOString().slice(0, 16) : '',
      end_time: entry.end_time ? new Date(entry.end_time).toISOString().slice(0, 16) : '',
      task_name: entry.task_name || '',
      description: entry.description || '',
      project_id: entry.project_id || null
    };
  }

  saveTimeEntry(entryId: number) {
    if (!this.isAdmin) return;
    
    const updateData: any = {};
    
    if (this.editEntryData.start_time) {
      updateData.start_time = new Date(this.editEntryData.start_time).toISOString();
    }
    if (this.editEntryData.end_time) {
      updateData.end_time = new Date(this.editEntryData.end_time).toISOString();
    }
    if (this.editEntryData.task_name !== undefined) {
      updateData.task_name = this.editEntryData.task_name;
    }
    if (this.editEntryData.description !== undefined) {
      updateData.description = this.editEntryData.description;
    }
    if (this.editEntryData.project_id !== undefined) {
      updateData.project_id = this.editEntryData.project_id;
    }
    
    this.adminService.updateTimeEntry(entryId, updateData).subscribe({
      next: () => {
        alert('Time entry updated successfully');
        this.editingEntryId = null;
        this.editEntryData = {};
        this.loadTimeEntries();
      },
      error: (err) => {
        alert('Error updating time entry: ' + (err.error?.message || 'Unknown error'));
      }
    });
  }

  cancelEdit() {
    this.editingEntryId = null;
    this.editEntryData = {};
  }

  deleteTimeEntry(entryId: number) {
    if (!this.isAdmin) return;
    
    if (!confirm('Are you sure you want to delete this time entry? This action cannot be undone.')) {
      return;
    }
    
    this.adminService.deleteTimeEntry(entryId).subscribe({
      next: () => {
        alert('Time entry deleted successfully');
        this.loadTimeEntries();
      },
      error: (err) => {
        alert('Error deleting time entry: ' + (err.error?.message || 'Unknown error'));
      }
    });
  }

  getTimeEntriesForActivity(activity: ActivityRow): any[] {
    // Get all time entries for this activity (task/project combination)
    return this.timeEntries.filter(entry => {
      const projectName = entry.project_name || 'Unknown Project';
      const taskName = entry.task_name || 'Unnamed Task';
      const taskKey = `${projectName} - ${taskName}`;
      return taskKey === `${activity.projectName} - ${activity.taskName}` && entry.end_time;
    });
  }

  getEntryTime(entry: any): number {
    // Calculate time in seconds from start_time and end_time
    if (!entry.start_time || !entry.end_time) return 0;
    const start = new Date(entry.start_time);
    const end = new Date(entry.end_time);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
    return Math.floor((end.getTime() - start.getTime()) / 1000);
  }

  // Add line functionality
  loadUsers() {
    // Load users for add line functionality (all users can add lines)
    // If user doesn't have permission to list users, that's okay - we'll just use empty array
    this.adminService.getUsers().subscribe({
      next: (users) => {
        this.users = users || [];
      },
      error: (err) => {
        // Silently fail - non-admin users may not have permission to list all users
        // This is fine since add line functionality doesn't require listing users
        console.log('Users list not available (this is normal for non-admin users)');
        this.users = [];
      }
    });
  }

  toggleAddLineForm() {
    this.showAddLineForm = !this.showAddLineForm;
    if (this.showAddLineForm) {
      // Initialize form with default values - set date to today
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      this.showCreateTaskInput = false;
      this.newTaskTitle = '';
      this.newTimeEntry = {
        project_id: null,
        date: dateStr,
        task_name: '',
        task_id: null,
        time_spent: '00:00',
        description: ''
      };
    }
  }

  toggleMaximizeModal() {
    this.isModalMaximized = !this.isModalMaximized;
  }

  onAddLineProjectChange() {
    // Reset task when project changes
    this.newTimeEntry.task_name = '';
    this.newTimeEntry.task_id = null;
    this.showCreateTaskInput = false;
    this.newTaskTitle = '';
    
    // Load tasks for the selected project
    if (this.newTimeEntry.project_id) {
      this.adminService.getTasks(this.newTimeEntry.project_id).subscribe({
        next: (tasks) => {
          if (tasks && Array.isArray(tasks)) {
            this.projectTasks[this.newTimeEntry.project_id] = tasks;
          } else {
            this.projectTasks[this.newTimeEntry.project_id] = [];
          }
        },
        error: (err) => {
          console.error('Error loading tasks:', err);
          this.projectTasks[this.newTimeEntry.project_id] = [];
        }
      });
    }
  }

  onAddLineTaskChange() {
    if (this.newTimeEntry.task_id === 'CREATE_TASK') {
      // Show create task input
      this.showCreateTaskInput = true;
      this.newTaskTitle = '';
      this.newTimeEntry.task_name = '';
    } else {
      // Hide create task input and set task name
      this.showCreateTaskInput = false;
      if (this.newTimeEntry.task_id) {
        const selectedTask = this.projectTasks[this.newTimeEntry.project_id]?.find(
          (t: any) => t.id === this.newTimeEntry.task_id
        );
        if (selectedTask) {
          this.newTimeEntry.task_name = selectedTask.title;
        }
      }
    }
  }

  createTaskFromAddLine() {
    if (!this.newTaskTitle || this.newTaskTitle.trim() === '') {
      this.toastService.show('Please enter a task title', 'error');
      return;
    }

    if (!this.newTimeEntry.project_id) {
      this.toastService.show('Please select a project first', 'error');
      return;
    }

    const currentUserId = this.authService.getUserId();
    const taskData = {
      project_id: this.newTimeEntry.project_id,
      title: this.newTaskTitle.trim(),
      description: this.newTimeEntry.description?.trim() || null,
      status: 'pending',
      assigned_to: currentUserId,
      assigned_by: null
    };

    this.adminService.createTask(taskData).subscribe({
      next: (taskResponse) => {
        this.toastService.show('Task created successfully', 'success');
        // Reload tasks for the project
        this.adminService.getTasks(this.newTimeEntry.project_id).subscribe({
          next: (tasks) => {
            if (tasks && Array.isArray(tasks)) {
              this.projectTasks[this.newTimeEntry.project_id] = tasks;
              // Select the newly created task
              const newTask = tasks.find((t: any) => t.title === this.newTaskTitle.trim());
              if (newTask) {
                this.newTimeEntry.task_id = newTask.id;
                this.newTimeEntry.task_name = newTask.title;
                this.showCreateTaskInput = false;
                this.newTaskTitle = '';
              }
            }
          },
          error: (err) => {
            console.error('Error reloading tasks:', err);
          }
        });
      },
      error: (err) => {
        console.error('Error creating task:', err);
        const errorMessage = err?.error?.message || err?.message || 'Failed to create task';
        this.toastService.show(`Error creating task: ${errorMessage}`, 'error');
      }
    });
  }

  cancelCreateTask() {
    this.showCreateTaskInput = false;
    this.newTaskTitle = '';
    this.newTimeEntry.task_id = null;
    this.newTimeEntry.task_name = '';
  }

  saveNewTimeEntry() {
    // Validate required fields
    if (!this.newTimeEntry.project_id || !this.newTimeEntry.task_name || !this.newTimeEntry.date || !this.newTimeEntry.time_spent) {
      this.toastService.show('Please fill in all required fields: Project, Date, Task, and Time Spent', 'error');
      return;
    }

    // If create task input is shown, don't allow saving
    if (this.showCreateTaskInput) {
      this.toastService.show('Please create the task first or select an existing task', 'error');
      return;
    }

    // Get current user ID
    const currentUserId = this.authService.getUserId();
    if (!currentUserId) {
      alert('User not found');
      return;
    }

    // Parse time spent (HH:MM format) - remove any spaces and validate
    let timeStr = this.newTimeEntry.time_spent.trim();
    
    // Remove AM/PM if present
    timeStr = timeStr.replace(/\s*(AM|PM|am|pm)\s*/i, '');
    
    // Remove seconds if present (HH:MM:SS -> HH:MM)
    if (timeStr.split(':').length === 3) {
      const parts = timeStr.split(':');
      timeStr = `${parts[0]}:${parts[1]}`;
    }
    
    // Validate HH:MM format
    const timePattern = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timePattern.test(timeStr)) {
      alert('Invalid time format. Please use HH:MM format (e.g., 02:45)');
      return;
    }
    
    const timeParts = timeStr.split(':');
    const hours = parseInt(timeParts[0]) || 0;
    const minutes = parseInt(timeParts[1]) || 0;
    
    if (hours === 0 && minutes === 0) {
      alert('Time spent must be greater than 0');
      return;
    }
    
    // Check if task exists, if not create it
    const taskName = this.newTimeEntry.task_name.trim();
    const projectId = parseInt(this.newTimeEntry.project_id);
    
    // Check if task already exists in the project
    const existingTasks = this.projectTasks[projectId] || [];
    const taskExists = existingTasks.some(task => task.title === taskName);
    
    if (!taskExists) {
      // Create the task first
      const taskData = {
        project_id: projectId,
        title: taskName,
        description: this.newTimeEntry.description?.trim() || null,
        status: 'pending',
        assigned_to: currentUserId, // Assign to current user
        assigned_by: null // User creating from timesheet
      };
      
      this.adminService.createTask(taskData).subscribe({
        next: (taskResponse) => {
          // Task created successfully, now create time entry
          this.createTimeEntryAfterTask(projectId, taskName, currentUserId, hours, minutes);
        },
        error: (err) => {
          alert('Error creating task: ' + (err.error?.message || 'Unknown error'));
        }
      });
    } else {
      // Task exists, just create time entry
      this.createTimeEntryAfterTask(projectId, taskName, currentUserId, hours, minutes);
    }
  }

  createTimeEntryAfterTask(projectId: number, taskName: string, userId: number, hours: number, minutes: number) {
    // Calculate start_time and end_time from date and time_spent
    const selectedDate = new Date(this.newTimeEntry.date);
    selectedDate.setHours(9, 0, 0, 0); // Set to 9 AM as start time
    const startTime = selectedDate.toISOString();
    
    // Calculate end time by adding time spent
    const timeSpentMs = (hours * 60 + minutes) * 60 * 1000;
    const endTime = new Date(selectedDate.getTime() + timeSpentMs).toISOString();
    
    // Validate dates
    const start = new Date(startTime);
    const end = new Date(endTime);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      alert('Invalid date format');
      return;
    }

    // Format dates for backend (MySQL DATETIME format: YYYY-MM-DD HH:mm:ss)
    const formatDateTimeForMySQL = (dateStr: string): string => {
      // If it's already in ISO format or has T, convert it
      if (dateStr.includes('T')) {
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      }
      // If it's already in MySQL format, return as is
      return dateStr.replace('T', ' ').substring(0, 19);
    };

    const entryData = {
      user_id: userId,
      project_id: projectId,
      task_name: taskName,
      description: this.newTimeEntry.description?.trim() || null,
      start_time: formatDateTimeForMySQL(startTime),
      end_time: formatDateTimeForMySQL(endTime)
    };

    this.adminService.createTimeEntry(entryData).subscribe({
      next: (response) => {
        if (response.success) {
          alert('Time entry added successfully');
          this.cancelAddLine();
          // Reload tasks for the project to include the new task
          if (this.projectTasks[projectId]) {
            this.adminService.getTasks(projectId).subscribe({
              next: (tasks) => {
                if (tasks && Array.isArray(tasks)) {
                  this.projectTasks[projectId] = tasks;
                }
              }
            });
          }
          this.loadTimeEntries();
        }
      },
      error: (err) => {
        alert('Error adding time entry: ' + (err.error?.message || 'Unknown error'));
      }
    });
  }

  cancelAddLine() {
    this.showAddLineForm = false;
    this.isModalMaximized = false;
    this.showCreateTaskInput = false;
    this.newTaskTitle = '';
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    this.newTimeEntry = {
      project_id: null,
      date: dateStr,
      task_name: '',
      task_id: null,
      time_spent: '00:00',
      description: ''
    };
  }

  // Search and filter methods
  toggleSearchDropdown() {
    this.showSearchDropdown = !this.showSearchDropdown;
  }

  onSearchInputChange() {
    this.showSearchSuggestions = true;
    this.processTimeEntries();
  }

  onSearchBlur() {
    // Delay hiding suggestions to allow click events
    setTimeout(() => {
      this.showSearchSuggestions = false;
    }, 200);
  }

  applySearchOption(option: string) {
    this.selectedSearchOption = option;
    this.showSearchSuggestions = false;
    this.processTimeEntries();
  }

  applyFilter(filter: string) {
    if (this.activeFilters.includes(filter)) {
      this.removeFilter(filter);
    } else {
      this.activeFilters.push(filter);
      this.processTimeEntries();
    }
  }

  removeFilter(filter: string) {
    this.activeFilters = this.activeFilters.filter(f => f !== filter);
    this.processTimeEntries();
  }

  isFilterActive(filter: string): boolean {
    return this.activeFilters.includes(filter);
  }

  getFilterDisplayName(filter: string): string {
    const filterNames: { [key: string]: string } = {
      'my-entries': 'My Entries'
    };
    return filterNames[filter] || filter;
  }

  toggleProjectFilter() {
    this.showProjectFilter = !this.showProjectFilter;
  }

  setProjectFilter(projectId: number | null) {
    this.selectedProjectFilter = projectId;
    this.processTimeEntries();
  }

  clearProjectFilter() {
    this.selectedProjectFilter = null;
    this.processTimeEntries();
  }

  getProjectName(projectId: number): string {
    const project = this.projects.find(p => p.id === projectId);
    return project ? project.name : `Project ${projectId}`;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.search-container-top')) {
      this.showSearchDropdown = false;
      this.showSearchSuggestions = false;
    }
  }

  // Individual activity timer methods
  getActivityKey(activity: ActivityRow): string {
    return `${activity.projectName} - ${activity.taskName}`;
  }

  isActivityTimerActive(activity: ActivityRow): boolean {
    const key = this.getActivityKey(activity);
    return !!this.activeActivityTimers[key];
  }

  startActivityTimer(activity: ActivityRow) {
    const key = this.getActivityKey(activity);
    
    // Stop any other active timers first
    this.stopAllActivityTimers();
    
    // Find project
    const project = this.projects.find(p => p.name === activity.projectName);
    if (!project) {
      alert('Project not found: ' + activity.projectName);
      return;
    }
    
    // Start timer via API
    this.adminService.startTime(project.id, activity.taskName, activity.description || '').subscribe({
      next: (response) => {
        if (response.success) {
          // Start local timer
          const startTime = new Date();
          this.activeActivityTimers[key] = {
            startTime: startTime,
            elapsedTime: 0,
            interval: null
          };
          
          // Update timer every second
          this.activeActivityTimers[key].interval = setInterval(() => {
            if (this.activeActivityTimers[key]) {
              const now = new Date();
              this.activeActivityTimers[key].elapsedTime = Math.floor((now.getTime() - startTime.getTime()) / 1000);
            }
          }, 1000);
          
          // Reload active entry to sync with backend
          this.loadActiveTimeEntry();
        }
      },
      error: (err) => {
        alert('Error starting timer: ' + (err.error?.message || 'Unknown error'));
      }
    });
  }

  stopActivityTimer(activity: ActivityRow) {
    const key = this.getActivityKey(activity);
    
    if (!this.activeActivityTimers[key]) {
      return;
    }
    
    // Stop the timer via API - need active entry ID
    if (!this.activeEntry || !this.activeEntry.id) {
      // Clear local timer if no active entry
      if (this.activeActivityTimers[key].interval) {
        clearInterval(this.activeActivityTimers[key].interval);
      }
      delete this.activeActivityTimers[key];
      return;
    }
    
    this.adminService.stopTime(this.activeEntry.id).subscribe({
      next: (response) => {
        if (response.success) {
          // Clear local timer
          if (this.activeActivityTimers[key].interval) {
            clearInterval(this.activeActivityTimers[key].interval);
          }
          delete this.activeActivityTimers[key];
          
          // Reload time entries to show the new entry
          this.loadTimeEntries();
          this.loadActiveTimeEntry();
        }
      },
      error: (err) => {
        alert('Error stopping timer: ' + (err.error?.message || 'Unknown error'));
      }
    });
  }

  stopAllActivityTimers() {
    Object.keys(this.activeActivityTimers).forEach(key => {
      if (this.activeActivityTimers[key].interval) {
        clearInterval(this.activeActivityTimers[key].interval);
      }
    });
    this.activeActivityTimers = {};
  }

  getActivityElapsedTime(activity: ActivityRow): number {
    const key = this.getActivityKey(activity);
    if (this.activeActivityTimers[key]) {
      return this.activeActivityTimers[key].elapsedTime;
    }
    return 0;
  }

  // View navigation methods
  onViewChange() {
    this.initializeWeek();
    this.loadTimeEntries();
  }

  navigateView(direction: number) {
    if (this.selectedView === 'day') {
      this.navigateDay(direction);
    } else if (this.selectedView === 'week') {
      this.navigateWeek(direction);
    } else if (this.selectedView === 'month') {
      this.navigateMonth(direction);
    }
  }

  navigateDay(direction: number) {
    const newDate = new Date(this.currentWeekStart);
    newDate.setDate(newDate.getDate() + direction);
    this.currentWeekStart = newDate;
    this.updateWeekDays();
    this.loadTimeEntries();
  }

  navigateMonth(direction: number) {
    const newDate = new Date(this.currentWeekStart);
    newDate.setMonth(newDate.getMonth() + direction);
    this.currentWeekStart = newDate;
    this.updateWeekDays();
    this.loadTimeEntries();
  }

  async exportToExcel() {
    try {
      // Dynamically import xlsx to avoid build issues
      const XLSX = await import('xlsx');
      
      // Prepare data for Excel export
      const excelData: any[] = [];
      
      // Add header row
      excelData.push([
        'Project Name',
        'Customer Name',
        'Region',
        'Task Name',
        'Project Allocated Time',
        'Task Allocated Time',
        'Time Spent',
        'Who Worked'
      ]);
      
      // Process each activity row
      this.activityRows.forEach(activity => {
        // Get project details
        let projectAllocatedTime = '-';
        let customerName = '-';
        let region = '-';
        
        if (activity.projectId) {
          const project = this.projects.find(p => p.id === activity.projectId);
          if (project) {
            if (project.allocated_time) {
              projectAllocatedTime = this.formatAllocatedTime(project.allocated_time);
            }
            customerName = project.customer_name || '-';
            region = project.region || '-';
          }
        }
        
        // Get task allocated_time
        const taskAllocatedTime = this.formatAllocatedTime(activity.allocatedTime);
        
        // Format time spent
        const timeSpent = this.formatTime(activity.totalTime);
        
        // Format who worked (combine all users)
        const whoWorked = activity.userList.length > 0 
          ? activity.userList.join(', ') 
          : Object.values(activity.users).map(u => u.name || u.email).join(', ') || '-';
        
        // Add data row
        excelData.push([
          activity.projectName || '-',
          customerName,
          region,
          activity.taskName || '-',
          projectAllocatedTime,
          taskAllocatedTime,
          timeSpent,
          whoWorked
        ]);
      });
      
      // Create worksheet
      const ws = XLSX.utils.aoa_to_sheet(excelData);
      
      // Set column widths
      const colWidths = [
        { wch: 25 }, // Project Name
        { wch: 20 }, // Customer Name
        { wch: 15 }, // Region
        { wch: 25 }, // Task Name
        { wch: 22 }, // Project Allocated Time
        { wch: 20 }, // Task Allocated Time
        { wch: 15 }, // Time Spent
        { wch: 30 }  // Who Worked
      ];
      ws['!cols'] = colWidths;
      
      // Create workbook
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Timesheet');
      
      // Generate filename with current date
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const filename = `timesheet_${dateStr}.xlsx`;
      
      // Save file
      XLSX.writeFile(wb, filename);
      
      // Show success message
      this.toastService.show('Timesheet exported to Excel successfully!', 'success');
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      this.toastService.show('Error exporting to Excel. Please try again.', 'error');
    }
  }
}
