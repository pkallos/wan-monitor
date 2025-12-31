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
