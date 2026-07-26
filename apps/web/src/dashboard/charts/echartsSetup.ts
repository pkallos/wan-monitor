import { LineChart } from "echarts/charts";
import {
  AxisPointerComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

export const registerEcharts = () => {
  echarts.use([
    AxisPointerComponent,
    CanvasRenderer,
    GridComponent,
    LegendComponent,
    LineChart,
    MarkLineComponent,
    TooltipComponent,
  ]);

  return echarts;
};
