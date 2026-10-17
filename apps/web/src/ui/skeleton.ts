import type { Html, HtmlBuilder } from "foldkit/html";

export const skeleton = <Message>(
  h: HtmlBuilder<Message>,
  className: string
): Html =>
  h.div(
    [
      h.AriaHidden(true),
      h.Class(`rounded-lg bg-track motion-safe:animate-pulse ${className}`),
    ],
    []
  );
