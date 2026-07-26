import { Runtime } from "foldkit";
import { Flags, flags } from "@/auth/flags";
import { init } from "@/auth/init";
import { Model } from "@/auth/model";
import { subscriptions } from "@/auth/subscription";
import { update } from "@/auth/update";
import { view } from "@/auth/view";
import { registerEcharts } from "@/dashboard/charts/echartsSetup";

registerEcharts();

const application = Runtime.makeApplication({
  Model,
  Flags,
  flags,
  init,
  update,
  view,
  subscriptions,
  container: document.getElementById("root"),
});

Runtime.run(application);
