import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  ALL_FORMATS,
  type AudioCodec,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferSource,
  BufferTarget,
  CanvasSink,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  type VideoCodec,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
} from "mediabunny";
import {
  AUDIO_BITRATE,
  AUDIO_CHANNELS,
  AUDIO_RATE,
  createResampler,
  type DecoderConfigLike,
  framesFor,
  type Job,
  type JobResult,
  MESSAGES,
  type Probe,
  planar,
  toStereo,
} from "./logic";

// The Web Worker of "Video Merger" (ADR 0051, ADR 0061). Mediabunny reads each clip in pieces in
// the order the visitor chose. The browser's WebCodecs decoder turns its pictures into frames,
// which are fitted inside the first clip's size with black bars and encoded again into one video
// track; each clip's sound is decoded from time 0, mixed to stereo, resampled to 48 kHz and
// encoded into one sound track, with silence for a clip that has none, so pictures and sound stay
// together from clip to clip. The joined file is built in memory and read back for its length.

const fresh = (file: Blob) => new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

/** A decoder config as plain data that survives postMessage: no VideoColorSpace objects. */
function plain(
  config: {
    codec: string;
    description?: unknown;
    sampleRate?: number;
    numberOfChannels?: number;
  } | null,
): DecoderConfigLike | null {
  if (!config) return null;
  return {
    codec: config.codec,
    ...(config.description ? { description: config.description } : {}),
    ...(config.sampleRate ? { sampleRate: config.sampleRate } : {}),
    ...(config.numberOfChannels ? { numberOfChannels: config.numberOfChannels } : {}),
  };
}

async function probe(file: Blob): Promise<Probe> {
  const input = fresh(file);
  try {
    if (!(await input.canRead())) throw new ToolError(MESSAGES.notVideo);
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new ToolError(MESSAGES.noVideo);
    const audio = await input.getPrimaryAudioTrack();
    const first = await video.getFirstTimestamp();
    return {
      durationSeconds: (await video.computeDuration()) - Math.max(0, first),
      width: video.displayWidth,
      height: video.displayHeight,
      videoConfig: plain(await video.getDecoderConfig()),
      audioConfig: audio ? plain(await audio.getDecoderConfig()) : null,
      pcmAudio: audio?.codec?.startsWith("pcm-") ?? false,
    };
  } catch (caught) {
    if (caught instanceof ToolError) throw caught;
    throw new ToolError(MESSAGES.unreadable);
  } finally {
    input.dispose();
  }
}

/** Silence in pieces of a tenth of a second. */
async function silence(source: AudioSampleSource, from: number, frames: number) {
  let written = 0;
  while (written < frames) {
    const length = Math.min(AUDIO_RATE / 10, frames - written);
    const zeros = new Float32Array(length * AUDIO_CHANNELS);
    const sample = new AudioSample({
      data: zeros,
      format: "f32-planar",
      numberOfChannels: AUDIO_CHANNELS,
      sampleRate: AUDIO_RATE,
      timestamp: (from + written) / AUDIO_RATE,
    });
    await source.add(sample);
    sample.close();
    written += length;
  }
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  if (job.kind === "probe") return { kind: "probe", probe: await probe(job.file) };

  progress({ done: 0, total: 1000, stage: "Reading the clips" });
  const output = new Output({
    format:
      job.container === "mp4"
        ? new Mp4OutputFormat({ fastStart: "in-memory" })
        : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const pictures = new VideoSampleSource({
    codec: job.video as VideoCodec,
    bitrate: QUALITY_HIGH,
    sizeChangeBehavior: "deny",
  });
  output.addVideoTrack(pictures);
  const sound = job.audio
    ? new AudioSampleSource({ codec: job.audio as AudioCodec, bitrate: AUDIO_BITRATE })
    : null;
  if (sound) output.addAudioTrack(sound);

  // The clips' lengths first, for the progress bar and the place of each clip in the result.
  const lengths: number[] = [];
  for (const file of job.files) lengths.push((await probe(file)).durationSeconds);
  const total = lengths.reduce((sum, seconds) => sum + seconds, 0);

  try {
    await output.start();
    let offset = 0;
    let soundFrames = 0;
    for (const [index, file] of job.files.entries()) {
      const input = fresh(file);
      try {
        const video = await input.getPrimaryVideoTrack();
        if (!video) throw new ToolError(MESSAGES.noVideo);
        const first = Math.max(0, await video.getFirstTimestamp());
        const length = lengths[index] ?? 0;
        const stage = `Clip ${index + 1} of ${job.files.length}`;
        const sink = new CanvasSink(video, {
          width: job.width,
          height: job.height,
          fit: "contain",
        });
        for await (const frame of sink.canvases(first)) {
          signal.throwIfAborted();
          const at = frame.timestamp - first;
          if (at >= length) break;
          const sample = new VideoSample(frame.canvas, {
            timestamp: offset + at,
            duration: Math.min(frame.duration, length - at),
          });
          await pictures.add(sample);
          sample.close();
          progress({
            done: Math.min(999, Math.round(((offset + at) / total) * 1000)),
            total: 1000,
            stage,
          });
        }

        if (sound) {
          // The sound of this clip fills exactly its length: cut where it runs on, silence where
          // it is short or missing.
          const wanted = framesFor(offset + length) - soundFrames;
          let made = 0;
          const audio = await input.getPrimaryAudioTrack();
          if (audio && job.sound[index]) {
            const resample = createResampler(audio.sampleRate, AUDIO_RATE);
            // From 0, as Mediabunny's own Conversion reads: from minus infinity the first decoded
            // sample never arrived for AAC in WebKit. Priming samples before 0 are not sound.
            for await (const piece of new AudioSampleSink(audio).samples(0)) {
              try {
                signal.throwIfAborted();
                if (made >= wanted) break;
                const planes: Float32Array[] = [];
                for (let plane = 0; plane < Math.min(2, piece.numberOfChannels); plane++) {
                  const options = { planeIndex: plane, format: "f32-planar" } as const;
                  const data = new Float32Array(piece.allocationSize(options) / 4);
                  piece.copyTo(data, options);
                  planes.push(data);
                }
                let [left, right] = resample(toStereo(planes));
                const keep = Math.min(left.length, wanted - made);
                left = left.subarray(0, keep);
                right = right.subarray(0, keep);
                if (keep > 0) {
                  const sample = new AudioSample({
                    data: planar(left, right),
                    format: "f32-planar",
                    numberOfChannels: AUDIO_CHANNELS,
                    sampleRate: AUDIO_RATE,
                    timestamp: (soundFrames + made) / AUDIO_RATE,
                  });
                  await sound.add(sample);
                  sample.close();
                  made += keep;
                }
              } finally {
                piece.close();
              }
            }
          }
          if (made < wanted) await silence(sound, soundFrames + made, wanted - made);
          soundFrames += wanted;
        }
        offset += length;
      } finally {
        input.dispose();
      }
    }
    pictures.close();
    sound?.close();
    await output.finalize();
  } catch (caught) {
    await output.cancel().catch(() => {});
    if (signal.aborted) throw caught;
    if (caught instanceof ToolError) throw caught;
    throw new ToolError(MESSAGES.failed);
  }

  const buffer = output.target.buffer;
  if (!buffer) throw new ToolError(MESSAGES.failed);
  const written = new Input({ source: new BufferSource(buffer), formats: ALL_FORMATS });
  let duration: number;
  try {
    duration = await written.computeDuration();
  } finally {
    written.dispose();
  }
  progress({ done: 1000, total: 1000, stage: "Done" });
  return {
    kind: "merge",
    blob: new Blob([buffer], { type: job.container === "mp4" ? "video/mp4" : "video/webm" }),
    durationMs: Math.round(duration * 1000),
    width: job.width,
    height: job.height,
  };
});
