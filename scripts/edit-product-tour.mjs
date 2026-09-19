import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Recut the recorded interactions on a 150 BPM bar grid. Music is exported separately only.
const dir = path.resolve("artifacts/product-tour");
const report = JSON.parse(await readFile(path.join(dir, "capture-report.json"), "utf8"));
const durations = [4.8, 4.8, 4.8, 6.4, 3.2, 3.2, 8, 3.2];
const titles = [
  "Curio. Your team's knowledge, in one place.",
  "Find useful tools and research with focused filters.",
  "Open a card for its summary, source and tags.",
  "See source age at a glance. Edit details when needed.",
  "Organize knowledge with shared topics.",
  "Manage your team's access.",
  "Capture links with the Curio Chrome extension.",
  "Save once. Discover and share together.",
];
function run(args) {
  const result = spawnSync("ffmpeg", ["-y", ...args], {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr);
}
let position = 0;
const timeline = durations.map((duration, i) => {
  const sourceStart = report.captions[i].start;
  const sourceEnd = report.captions[i + 1]?.start ?? report.durationSeconds;
  const item = { start: position, duration, sourceStart, sourceEnd, text: titles[i] };
  position += duration;
  return item;
});
const videoArgs = [
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "19",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
];
// Render bounded clips separately: older FFmpeg builds can extend the last frame of a
// trim/fps filter branch when concatenating multiple branches from one input.
for (const [i, item] of timeline.entries()) {
  run([
    "-ss",
    String(item.sourceStart),
    "-i",
    "curio-tour-clean.mp4",
    "-vf",
    `setpts=${item.duration / (item.sourceEnd - item.sourceStart)}*(PTS-STARTPTS),fps=30,setsar=1`,
    ...videoArgs,
    "-t",
    String(item.duration),
    `edit-part-${i}.mp4`,
  ]);
}
await writeFile(
  path.join(dir, "edit-parts.txt"),
  timeline.map((_, i) => `file 'edit-part-${i}.mp4'`).join("\n"),
);
run([
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  "edit-parts.txt",
  "-c",
  "copy",
  "-an",
  "-movflags",
  "+faststart",
  "curio-tour-38s-clean.mp4",
]);
function stamp(time) {
  const ms = Math.round(time * 1000);
  return `00:${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
await writeFile(
  path.join(dir, "curio-tour-38s.en.srt"),
  timeline
    .map(
      (item, i) =>
        `${i + 1}\n${stamp(item.start)} --> ${stamp(item.start + item.duration - 0.08)}\n${item.text}\n`,
    )
    .join("\n"),
);
run([
  "-i",
  "curio-tour-38s-clean.mp4",
  "-vf",
  "subtitles=curio-tour-38s.en.srt:force_style='FontName=Arial,FontSize=10,PrimaryColour=&HFFFFFF,OutlineColour=&H802B211B,BorderStyle=3,Outline=3,Shadow=0,MarginV=10'",
  ...videoArgs,
  "curio-tour-38s.en.mp4",
]);
const audioFilter =
  "atrim=start=0:end=38.4,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.25,afade=t=out:st=36.8:d=1.6";
run([
  "-i",
  "Cipher-original.mp3",
  "-af",
  audioFilter,
  "-ar",
  "48000",
  "-c:a",
  "pcm_s24le",
  "curio-music-38s.wav",
]);
run(["-i", "curio-music-38s.wav", "-c:a", "libmp3lame", "-b:a", "256k", "curio-music-38s.mp3"]);
await writeFile(
  path.join(dir, "edit-timeline.json"),
  JSON.stringify(
    {
      duration: 38.4,
      bpm: 150,
      bars: 24,
      musicEmbedded: false,
      music: "Cipher — Kevin MacLeod",
      timeline,
    },
    null,
    2,
  ),
);
console.log("Exported 38.4-second silent videos, English SRT, and separate WAV/MP3 music.");
