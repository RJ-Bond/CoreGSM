import { createContext, useContext } from 'react';
import type { Access, Me } from './api';

export interface AuthState {
  /** null = a guest */
  me: Me | null;
  isAdmin: boolean;
  access: Access;
  /** re-read who is signed in and the access settings */
  reload: () => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthState>({
  me: null,
  isAdmin: false,
  access: { publicPanel: true, registration: true },
  reload: async () => undefined,
  logout: () => undefined,
});

export const useAuth = () => useContext(AuthContext);
