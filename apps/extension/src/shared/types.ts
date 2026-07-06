export type Tone =
  | "degen"
  | "bullish"
  | "smart"
  | "funny"
  | "respectful"
  | "short_alpha";

export type FakeReply = {
  id: string;
  text: string;
};

export type ExtractedPostContext = {
  postText: string;
  authorHandle?: string;
  authorName?: string;
  postUrl?: string;
  visibleThreadText?: string[];
  timestampText?: string;
};
