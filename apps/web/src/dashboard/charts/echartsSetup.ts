import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import {
  AxisPointerComponent,
  BrushComponent,
  DataZoomInsideComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

export const registerEcharts = () => {
  echarts.use([
    AxisPointerComponent,
    BarChart,
    BrushComponent,
    CanvasRenderer,
    DataZoomInsideComponent,
    GridComponent,
    LegendComponent,
    LineChart,
    MarkAreaComponent,
    MarkLineComponent,
    ScatterChart,
    ToolboxComponent,
    TooltipComponent,
  ]);

  return echarts;
};
