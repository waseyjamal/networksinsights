import { Button, Input, Select, Textarea } from "@ui";
import { useEffect, useState } from "react";
import {
  clean,
  displayUrl,
  type Input as Fields,
  OG_TYPES,
  type OgType,
  ROBOTS,
  type Robots,
  RULE_OF_THUMB,
  run,
  TWITTER_CARDS,
  type TwitterCard,
} from "./logic";

// The workspace of Meta Tag Generator: the fields, an approximate search result preview and the
// HTML to copy. The tags are rewritten on every keystroke; nothing leaves the page.

const COPIED_MESSAGE_MS = 3000;

const START: Fields = {
  title: "Fresh Sourdough Bread",
  description: "Order a fresh sourdough loaf, baked every morning.",
  canonical: "https://example.com/bread/sourdough",
  robots: "index, follow",
  siteName: "Example Bakery",
  ogType: "website",
  image: "",
  imageAlt: "",
  twitterCard: "summary",
  twitterSite: "",
};

/** The length guide under a field: a rule of thumb, never a verdict. */
function guide(length: number, thumb: number): string {
  return `${length} characters. Rule of thumb: about ${thumb} often show in full; search engines cut by pixel width.`;
}

export default function ToolUi() {
  const [fields, setFields] = useState<Fields>(START);
  const [message, setMessage] = useState("");
  const result = run(fields);
  const errors = result.ok ? {} : result.errors;

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((current) => ({ ...current, [key]: value }));

  const copy = async () => {
    if (!result.ok) return;
    try {
      await navigator.clipboard.writeText(result.html);
      setMessage("HTML copied to the clipboard.");
    } catch {
      setMessage("Your browser did not allow copying. Select the HTML and copy it.");
    }
  };

  const title = clean(fields.title);
  const description = clean(fields.description);

  return (
    <>
      <Input
        id="meta-title"
        label="Title"
        value={fields.title}
        error={errors.title}
        hint={errors.title ? undefined : guide(title.length, RULE_OF_THUMB.title)}
        onChange={(event) => set("title", event.target.value)}
      />
      <Textarea
        id="meta-description"
        label="Description"
        rows={3}
        value={fields.description}
        error={errors.description}
        hint={errors.description ? undefined : guide(description.length, RULE_OF_THUMB.description)}
        onChange={(event) => set("description", event.target.value)}
      />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Input
          id="meta-canonical"
          label="Canonical URL (optional)"
          type="url"
          inputMode="url"
          spellCheck={false}
          value={fields.canonical}
          error={errors.canonical}
          onChange={(event) => set("canonical", event.target.value)}
        />
        <Select
          id="meta-robots"
          label="Robots"
          value={fields.robots}
          onChange={(event) => set("robots", event.target.value as Robots)}
        >
          {ROBOTS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Input
          id="meta-site-name"
          label="Site name (optional)"
          value={fields.siteName}
          error={errors.siteName}
          onChange={(event) => set("siteName", event.target.value)}
        />
        <Select
          id="meta-og-type"
          label="Open Graph type"
          value={fields.ogType}
          onChange={(event) => set("ogType", event.target.value as OgType)}
        >
          {OG_TYPES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Input
          id="meta-image"
          label="Share image URL (optional)"
          type="url"
          inputMode="url"
          spellCheck={false}
          value={fields.image}
          error={errors.image}
          onChange={(event) => set("image", event.target.value)}
        />
        <Input
          id="meta-image-alt"
          label="Share image description (optional)"
          value={fields.imageAlt}
          error={errors.imageAlt}
          onChange={(event) => set("imageAlt", event.target.value)}
        />
        <Select
          id="meta-twitter-card"
          label="Twitter card"
          value={fields.twitterCard}
          onChange={(event) => set("twitterCard", event.target.value as TwitterCard)}
        >
          {TWITTER_CARDS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Input
          id="meta-twitter-site"
          label="X (Twitter) handle (optional)"
          spellCheck={false}
          value={fields.twitterSite}
          error={errors.twitterSite}
          onChange={(event) => set("twitterSite", event.target.value)}
        />
      </div>

      <section aria-labelledby="meta-preview-title" className="grid gap-2">
        <h3 id="meta-preview-title" className="text-lg">
          Search result preview (approximate)
        </h3>
        <div id="meta-preview" className="grid gap-1 rounded-xl border border-border p-4">
          <p className="text-sm text-fg-muted">{displayUrl(fields.canonical)}</p>
          <p className="line-clamp-1 text-lg text-brand-text">{title}</p>
          <p className="line-clamp-2 text-sm">{description}</p>
        </div>
        <p className="text-sm text-fg-muted">
          Approximate: each search engine draws results its own way, may cut the title and
          description at a different width, and may show other text from your page instead.
        </p>
      </section>

      <Textarea
        id="meta-html"
        label="HTML for the head of your page"
        className="font-mono"
        readOnly
        rows={result.ok ? result.lineCount : 3}
        value={result.ok ? result.html : ""}
        placeholder="Fix the fields marked above to see the tags."
      />
      <div className="ni-workspace__actions">
        <Button variant="primary" disabled={!result.ok} onClick={() => void copy()}>
          Copy HTML
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {message}
      </p>
    </>
  );
}
