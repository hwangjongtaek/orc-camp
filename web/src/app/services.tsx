/** App-wide singletons (REST client + realtime engine) exposed to components. */
import { createContext, useContext, type ReactNode } from 'react';
import type { ApiClient } from '../api/client';
import type { RealtimeEngine } from '../realtime/engine';

export interface AppServices {
  api: ApiClient;
  engine: RealtimeEngine;
}

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}): JSX.Element {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useServices must be used within ServicesProvider');
  return ctx;
}
