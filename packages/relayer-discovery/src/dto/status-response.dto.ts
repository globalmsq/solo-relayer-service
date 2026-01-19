export interface RelayerStatus {
  id: string;
  status: "healthy" | "unhealthy";
  lastCheckTimestamp: string | null;
  url: string;
}

export interface StatusResponse {
  service: string;
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  activeRelayers: RelayerStatus[];
  totalConfigured: number;
  totalActive: number;
  healthCheckInterval: number;
}
