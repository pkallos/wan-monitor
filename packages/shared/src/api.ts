export interface PingMetric {
  timestamp: string;
  host: string;
  latency: number;
  packet_loss: number;
  connectivity_status: string;
  jitter?: number;
}

export interface PingMetricsResponse {
  data: PingMetric[];
  meta: {
    startTime: string;
    endTime: string;
    count: number;
  };
}

export interface ApiError {
  error: string;
  message: string;
}

export interface SpeedMetric {
  timestamp: string;
  download_speed: number; // Mbps
  upload_speed: number; // Mbps
  latency: number; // ms
  jitter?: number; // ms
  server_location?: string;
  isp?: string;
}

export interface SpeedMetricsResponse {
  data: SpeedMetric[];
  meta: {
    startTime: string;
    endTime: string;
    count: number;
  };
}
