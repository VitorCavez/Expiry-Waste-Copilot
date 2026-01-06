
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { UserProfile, AccessTier } from '../types';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

/**
 * Authentication Service
 * Integrates Supabase Auth with Email OTP.
 * Provides a Dev Sign-In fallback when environment variables are missing.
 */
class AuthService {
  private supabase: SupabaseClient | null = null;
  private SESSION_KEY = 'copilot_session_v1';

  constructor() {
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
  }

  isConfigured(): boolean {
    return !!this.supabase;
  }

  async sendMagicLink(email: string): Promise<{ success: boolean; message: string }> {
    if (!this.supabase) {
      return { success: false, message: "Auth is not configured. Please add SUPABASE_URL and SUPABASE_ANON_KEY to your environment." };
    }

    const { error } = await this.supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      }
    });

    if (error) {
      return { success: false, message: error.message };
    }

    return { 
      success: true, 
      message: "Check your inbox. We've sent a 6-digit verification code." 
    };
  }

  async verifyOtp(email: string, otp: string): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    if (!this.supabase) return { success: false, error: "Supabase not configured." };

    const { data, error } = await this.supabase.auth.verifyOtp({
      email,
      token: otp,
      type: 'email',
    });

    if (error || !data.user) {
      return { success: false, error: error?.message || "Verification failed." };
    }

    const user: UserProfile = {
      id: data.user.id,
      email: data.user.email || email,
      createdAt: data.user.created_at,
      accessTier: 'beta'
    };
    
    this.saveSession(user);
    return { success: true, user };
  }

  /**
   * Safe development fallback for preview mode.
   * Signs in immediately without an email trigger.
   */
  async devSignIn(): Promise<UserProfile> {
    const user: UserProfile = {
      id: 'dev-user-001',
      email: 'dev@example.local',
      createdAt: new Date().toISOString(),
      accessTier: 'lifetime'
    };
    this.saveSession(user);
    return user;
  }

  private saveSession(user: UserProfile) {
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(user));
  }

  getSession(): UserProfile | null {
    const data = localStorage.getItem(this.SESSION_KEY);
    if (!data) return null;
    try {
      return JSON.parse(data) as UserProfile;
    } catch (e) {
      return null;
    }
  }

  logout() {
    localStorage.removeItem(this.SESSION_KEY);
  }
}

export const authService = new AuthService();
