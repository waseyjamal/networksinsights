import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

const entry = z.object({
  title: z.string().max(2000),
  place: z.string().max(2000),
  dates: z.string().max(2000),
  details: z.string().max(2000),
});

export default defineTool({
  id: "resume-builder",
  name: "Resume Builder",
  category: "generators",
  summary:
    "Fill in a simple form and download a plain one-column resume as a PDF, with a live preview and no account.",
  tags: ["resume", "cv", "pdf", "job"],
  produces: ["PDF"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    name: z.string().min(1).max(2000),
    contact: z.string().max(2000),
    summary: z.string().max(2000),
    experience: z.array(entry).max(10),
    education: z.array(entry).max(10),
    skills: z.string().max(2000),
    paper: z.enum(["a4", "letter"]),
  }),
  related: ["word-counter", "image-to-pdf"],
  added: "2026-10-03",
  updated: "2026-10-03",
});
