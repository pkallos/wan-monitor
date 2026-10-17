import { AsyncData } from "foldkit";

/** True until a fetch has settled once, so a skeleton shows only on first load. */
export const isAwaitingData = <A, E>(
  data: AsyncData.AsyncData<A, E>
): boolean => AsyncData.isIdle(data) || AsyncData.isLoading(data);
