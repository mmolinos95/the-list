// Every notification goes through a Channel. Email (Gmail) is the first one;
// WhatsApp or SMS can be added later as another Channel without touching the
// sign-up logic. See PLAN.md, "Built to expand".

export type OutgoingMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export interface Channel {
  name: string;
  send(message: OutgoingMessage): Promise<void>;
}
