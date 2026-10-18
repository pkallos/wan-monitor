import type { SpeedSummary } from "@wan-monitor/shared";
import { median } from "@/core/analytics/stats";
import type { MetricRow } from "@/infrastructure/database/questdb/model";

/** An absent figure and a stored 0 both mean the test took no reading. */
const isMeasured = (value: number | undefined): value is number =>
  value !== undefined && value > 0;

/**
 * Median download and upload speeds in `rows`, in Mbps. Speed tests are
 * sparse, so the median is exact rather than approximated in the database.
 */
export const summarizeSpeed = (rows: readonly MetricRow[]): SpeedSummary => {
  const downloads = rows.map((row) => row.download_speed).filter(isMeasured);
  const uploads = rows.map((row) => row.upload_speed).filter(isMeasured);

  return {
    downloadMedian: median(downloads),
    uploadMedian: median(uploads),
    count: rows.filter(
      (row) => isMeasured(row.download_speed) || isMeasured(row.upload_speed)
    ).length,
  };
};
