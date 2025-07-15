// API Service for Interactive Tutor Backend
const API_BASE_URL = 'http://localhost:8000';

// Type definitions based on the course structure
export interface Module {
  title: string;
  description: string;
}

export interface Topic {
  title: string;
  description: string;
  modules: Module[];
}

export interface Course {
  id: string;
  title: string;
  description: string;
  category: string;
  estimatedDuration: string;
  topics: Topic[];
}

// User-related types
export interface OnboardingData {
  interests: string[];
  hobbies: string[];
  preferredAnalogies: string[];
  age: number;
}

export interface User {
  id: string;
  name: string;
  onboarding_data: OnboardingData;
}

export interface CreateUserRequest {
  id: string;
  name: string;
  onboarding_data: OnboardingData;
}

// Session-related types
export interface CreateSessionRequest {
  user_id: string;
  course_id: string;
}

export interface SessionProgress {
  topic_id: string;
  module_id: string;
  phase_id: number;
}

export interface Session {
  id: string;
  user_id: string;
  course_id: string;
  created_at: string;
  status: string;
  progress: SessionProgress;
}

// API response types
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

// Error class for API errors
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Generic API request function
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const defaultOptions: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await fetch(url, defaultOptions);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        errorData.message || `HTTP error! status: ${response.status}`,
        response.status,
        errorData
      );
    }

    const data = await response.json();
    return data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      0
    );
  }
}

// API service functions
export const apiService = {
  /**
   * Get a specific course by ID
   * @param courseId - The ID of the course to fetch
   * @returns Promise<Course>
   */
  async getCourse(courseId: string): Promise<Course> {
    return apiRequest<Course>(`/api/courses/${courseId}`);
  },

  /**
   * List all available courses
   * @returns Promise<Course[]>
   */
  async listCourses(): Promise<Course[]> {
    return apiRequest<Course[]>('/api/courses/');
  },

  /**
   * Create a new learning session
   * @param request - The session creation request
   * @returns Promise<Session>
   */
  async createSession(request: CreateSessionRequest): Promise<Session> {
    return apiRequest<Session>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  /**
   * Create a new user
   * @param request - The user creation request
   * @returns Promise<User>
   */
  async createUser(request: CreateUserRequest): Promise<User> {
    return apiRequest<User>('/api/users', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  /**
   * Get a user by ID
   * @param userId - The ID of the user to fetch
   * @returns Promise<User>
   */
  async getUser(userId: string): Promise<User> {
    return apiRequest<User>(`/api/users/${userId}`);
  },
};

// Export default
export default apiService; 