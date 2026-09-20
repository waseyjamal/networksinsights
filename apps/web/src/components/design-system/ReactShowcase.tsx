import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dropzone,
  Input,
  Progress,
  Select,
  Switch,
  Tabs,
  Textarea,
  Tooltip,
} from "../ui/react";

// The same components from a React island. The styles are the shared components.css; nothing
// here defines a style of its own beyond page layout.
export default function ReactShowcase() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(35);
  const [notify, setNotify] = useState(true);
  const [email, setEmail] = useState("not-an-email");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const run = () => {
    setLoading(true);
    timer.current = setTimeout(() => setLoading(false), 1500);
  };

  const emailError = email.includes("@")
    ? undefined
    : "Enter an email address like name@example.com.";

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={loading} onClick={run}>
            {loading ? "Working" : "Run in React"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setProgress((value) => (value >= 100 ? 0 : value + 15))}
          >
            Advance progress
          </Button>
          <Tooltip
            id="react-tip"
            text="Tooltips also work from a React island. Press Esc to dismiss."
          >
            <Button variant="ghost" aria-describedby="react-tip">
              Hover or focus me
            </Button>
          </Tooltip>
        </div>
        <Progress value={progress} label="React progress demo" />
        <Input
          id="react-email"
          label="Email"
          hint="We never send anything. This is a demo."
          error={emailError}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Textarea id="react-note" label="Note" placeholder="Type something" rows={3} />
        <Select id="react-format" label="Format" defaultValue="webp">
          <option value="webp">WebP</option>
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
        </Select>
        <div className="flex flex-wrap gap-6">
          <Checkbox label="Keep metadata" defaultChecked />
          <Switch
            label="Notify me"
            checked={notify}
            onChange={(event) => setNotify(event.target.checked)}
          />
        </div>
      </div>
      <div className="space-y-5">
        <Tabs
          id="react-tabs"
          label="React tabs example"
          tabs={[
            {
              id: "one",
              label: "Overview",
              panel: <p>Tabs use roving tabindex and arrow keys.</p>,
            },
            {
              id: "two",
              label: "Usage",
              panel: <p>Import from the design system's React entry point.</p>,
            },
            { id: "three", label: "Notes", panel: <p>Styles come from one shared stylesheet.</p> },
          ]}
        />
        <Dropzone hint="or click to browse. Up to 100 MB" />
        <Alert tone="success" title="Saved">
          Rendered by React, styled by the same CSS.
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="brand">Brand</Badge>
          <Badge tone="success">Success</Badge>
          <Badge tone="warning">Warning</Badge>
          <Badge tone="danger">Danger</Badge>
          <Badge tone="info">Info</Badge>
        </div>
      </div>
    </div>
  );
}
