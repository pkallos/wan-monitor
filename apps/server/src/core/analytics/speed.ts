import type { Metric, SpeedSummary } from "@wan-monitor/shared";
import { median } from "@/core/analytics/stats";

/**
 * Median download and upload speeds in `rows`, in Mbps. Speed tests are
 * sparse, so the median is exact rather than approximated in the database.
 */
export const summarizeSpeed = (rows: readonly Metric[]): SpeedSummary => {
  const downloads = rows.flatMap((row) => row.download_speed ?? []);
  const uploads = rows.flatMap((row) => row.upload_speed ?? []);

  return {
    downloadMedian: median(downloads),
    uploadMedian: median(uploads),
    count: rows.filter(
      (row) =>
        row.download_speed !== undefined || row.upload_speed !== undefined
    ).length,
  };
};
