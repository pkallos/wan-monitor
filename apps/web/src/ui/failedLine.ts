import type { Html, HtmlBuilder } from "foldkit/html";

/**
 * What a card says when its data could not be fetched. It stands where the
 * empty-state copy would be, so a failure never reads as nothing to show; the
 * page's error banner carries the cause and the retry.
 */
export const failedLine = <Message>(
  h: HtmlBuilder<Message>,
  message: string,
  className = "text-[15px] text-ink-2"
): Html => h.p([h.Class(className)], [message]);
