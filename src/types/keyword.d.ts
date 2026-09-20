interface Keyword {
  keyword: string;
  type: "none" | "text" | "option" | "closeAI";
  text?: string;
  optionId?: string;
}
