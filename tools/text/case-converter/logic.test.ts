import { describe, expect, it } from "vitest";
import { convert, MODE_LABELS, MODES, type Mode, nameWords, run } from "./logic";

const all = (text: string) =>
  Object.fromEntries(MODES.map((mode) => [mode, convert(text, mode)])) as Record<Mode, string>;

/** A combining acute accent, written by its code so the test shows it. */
const ACUTE = String.fromCharCode(0x301);

describe("run", () => {
  it("converts the example of the page into every case", () => {
    expect(all("the lord of the rings: the return of the king")).toEqual({
      upper: "THE LORD OF THE RINGS: THE RETURN OF THE KING",
      lower: "the lord of the rings: the return of the king",
      title: "The Lord of the Rings: The Return of the King",
      sentence: "The lord of the rings: the return of the king",
      camel: "theLordOfTheRingsTheReturnOfTheKing",
      pascal: "TheLordOfTheRingsTheReturnOfTheKing",
      snake: "the_lord_of_the_rings_the_return_of_the_king",
      kebab: "the-lord-of-the-rings-the-return-of-the-king",
    });
  });

  it("gives back an empty text for an empty input, in every case", () => {
    for (const mode of MODES) expect(run({ text: "", mode })).toEqual({ output: "" });
  });

  it("labels each case in that case", () => {
    for (const mode of MODES) {
      if (mode === "title" || mode === "sentence") continue;
      expect(convert(MODE_LABELS[mode].replace(/[_-]/g, " "), mode)).toBe(MODE_LABELS[mode]);
    }
    expect(convert("title case", "title")).toBe(MODE_LABELS.title);
    expect(convert("SENTENCE CASE", "sentence")).toBe(MODE_LABELS.sentence);
  });
});

describe("uppercase and lowercase", () => {
  it("follow the Unicode case rules of every script", () => {
    expect(convert("straße café ωμέγα привет", "upper")).toBe("STRASSE CAFÉ ΩΜΈΓΑ ПРИВЕТ");
    expect(convert("ΟΔΥΣΣΕΥΣ", "lower")).toBe("οδυσσευς");
  });

  it("leave emoji, Chinese and Japanese text, digits and punctuation as they are", () => {
    const text = "Hi 👨‍👩‍👧 🇮🇳 👍🏽 你好世界。カタカナ 42%!";
    expect(convert(text, "upper")).toBe("HI 👨‍👩‍👧 🇮🇳 👍🏽 你好世界。カタカナ 42%!");
    expect(convert(text, "lower")).toBe("hi 👨‍👩‍👧 🇮🇳 👍🏽 你好世界。カタカナ 42%!");
  });
});

describe("title case", () => {
  it("keeps short English words lowercase except at the start, the end and after a colon", () => {
    expect(convert("A TALE OF TWO CITIES", "title")).toBe("A Tale of Two Cities");
    expect(convert("what are you looking at", "title")).toBe("What Are You Looking At");
    expect(convert("star wars: a new hope", "title")).toBe("Star Wars: A New Hope");
  });

  it("capitalizes each part of a hyphenated word and keeps apostrophes inside a word", () => {
    expect(convert("a well-known story isn't it", "title")).toBe("A Well-Known Story Isn't It");
  });

  it("lowercases the rest of every word, acronyms included", () => {
    expect(convert("NASA and the iPhone", "title")).toBe("Nasa and the Iphone");
  });

  it("works line by line and keeps every line break", () => {
    expect(convert("the end\r\nof the line\n\nin the sea", "title")).toBe(
      "The End\r\nOf the Line\n\nIn the Sea",
    );
  });

  it("capitalizes accented and non-Latin words and leaves emoji alone", () => {
    expect(convert(`e${ACUTE}cole de paris 🎨 москва`, "title")).toBe(
      `E${ACUTE}cole De Paris 🎨 Москва`,
    );
  });
});

describe("sentence case", () => {
  it("capitalizes the first letter of every sentence and lowercases the rest", () => {
    expect(convert("HELLO THERE. HOW ARE YOU? FINE! THANKS", "sentence")).toBe(
      "Hello there. How are you? Fine! Thanks",
    );
  });

  it("starts a new sentence on every line", () => {
    expect(convert("first line\nsecond line\r\n\r\nthird", "sentence")).toBe(
      "First line\nSecond line\r\n\r\nThird",
    );
  });

  it("looks past closing quotes and opening punctuation", () => {
    expect(convert('he said "stop." (then he left.) "why?"', "sentence")).toBe(
      'He said "stop." (Then he left.) "Why?"',
    );
  });

  it("does not end a sentence inside a number or an abbreviation without a space", () => {
    expect(convert("PI IS 3.14 OR SO, I.E. ABOUT THREE", "sentence")).toBe(
      "Pi is 3.14 or so, i.e. About three",
    );
  });

  it("keeps a sentence that starts with a number in lowercase", () => {
    expect(convert("done. 3 APPLES LEFT", "sentence")).toBe("Done. 3 apples left");
  });

  it("capitalizes the English pronoun I", () => {
    expect(convert("YES, I THINK I'M RIGHT AND I'VE SAID SO", "sentence")).toBe(
      "Yes, I think I'm right and I've said so",
    );
  });

  it("leaves emoji, Chinese and Japanese text as they are", () => {
    expect(convert("👋 HELLO。你好。WORLD", "sentence")).toBe("👋 Hello。你好。World");
  });
});

describe("camelCase, PascalCase, snake_case and kebab-case", () => {
  it("split words at spaces, punctuation and changes of case", () => {
    expect(nameWords("XMLHttpRequest")).toEqual(["XML", "Http", "Request"]);
    expect(nameWords("user_id, userName and v2Api")).toEqual([
      "user",
      "id",
      "user",
      "Name",
      "and",
      "v2",
      "Api",
    ]);
  });

  it("convert names from one style to another", () => {
    expect(convert("getHTTPResponseCode", "snake")).toBe("get_http_response_code");
    expect(convert("background-color", "camel")).toBe("backgroundColor");
    expect(convert("MAX_RETRY_COUNT", "pascal")).toBe("MaxRetryCount");
    expect(convert("MyComponentName", "kebab")).toBe("my-component-name");
  });

  it("drop apostrophes inside a word, punctuation, symbols and emoji", () => {
    expect(convert("Don't stop 🎉 me now!", "snake")).toBe("dont_stop_me_now");
    expect(convert("price ($) & tax", "kebab")).toBe("price-tax");
  });

  it("keep accented letters, other scripts and Chinese text", () => {
    expect(convert("café au lait", "camel")).toBe("caféAuLait");
    expect(convert("привет мир", "pascal")).toBe("ПриветМир");
    expect(convert("你好 世界 hello", "snake")).toBe("你好_世界_hello");
  });

  it("convert each line on its own and keep the line breaks", () => {
    expect(convert("first name\nlast name\r\n\r\ne-mail address", "camel")).toBe(
      "firstName\nlastName\r\n\r\neMailAddress",
    );
  });

  it("give an empty line for a line of spaces, punctuation or emoji only", () => {
    expect(convert("  \n!!!\n🙂", "kebab")).toBe("\n\n");
  });
});
