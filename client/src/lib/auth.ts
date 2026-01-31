import { apiClient, unwrapResponse } from '@/lib/api';
import { LoginData, RegisterData, AuthResponse } from '@/types';

// Update API client config to use auth from store
import { useAuthStore } from '@/lib/stores/auth';

// Auth API functions
export const authApi = {
  // Register with phone and verification code
  register: async (data: RegisterData): Promise<AuthResponse> => {
    const response = await apiClient.post('/auth/register', data);
    const { data: payload } = unwrapResponse<AuthResponse>(response);
    return payload;
  },

  // Login with phone and verification code
  login: async (data: LoginData): Promise<AuthResponse> => {
    const response = await apiClient.post('/auth/login', data);
    const { data: payload } = unwrapResponse<AuthResponse>(response);
    return payload;
  },

  // Get current user profile
  getProfile: async () => {
    const response = await apiClient.get('/auth/profile');
    const { data } = unwrapResponse(response);
    return data;
  },

  // Refresh token
  refreshToken: async () => {
    const response = await apiClient.post('/auth/refresh');
    const { data } = unwrapResponse(response);
    return data;
  },
};

// Helper functions for auth management
export const auth = {
  login: async (data: LoginData) => {
    try {
      useAuthStore.getState().setLoading(true);
      const result = await authApi.login(data);

      useAuthStore.getState().login(result.token, result.user);
      return result;
    } catch (error) {
      useAuthStore.getState().setLoading(false);
      throw error;
    }
  },

  register: async (data: RegisterData) => {
    try {
      useAuthStore.getState().setLoading(true);
      const result = await authApi.register(data);

      useAuthStore.getState().login(result.token, result.user);
      return result;
    } catch (error) {
      useAuthStore.getState().setLoading(false);
      throw error;
    }
  },

  logout: () => {
    useAuthStore.getState().logout();
  },

  isAuthenticated: () => {
    return useAuthStore.getState().isAuthenticated;
  },

  getToken: () => {
    return useAuthStore.getState().token;
  },

  getUser: () => {
    return useAuthStore.getState().user;
  },
};
