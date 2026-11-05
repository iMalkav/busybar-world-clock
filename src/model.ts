import {
  str,
  flag,
  cycle,
  bounded,
  pad,
  localDay,
  splitList,
  App,
  MINUTE,
  type Settings,
  type View,
} from "./lib.ts";

export class AppModel extends App {
  clocks: { name: string; offset: number }[] = [];
  selected = 0;
  changedAt = 0;
  constructor(s: Settings, saved: Settings, now: number) {
    super(s, saved, now);
    this.changedAt = now;
    for (const entry of splitList(str(s, "clocks"), 8)) {
      const parts = entry.split("=");
      const offset = Number(parts[1]);
      if (
        parts.length === 2 &&
        parts[0] &&
        Number.isFinite(offset) &&
        offset >= -720 &&
        offset <= 840
      )
        this.clocks.push({ name: parts[0], offset });
    }
    if (!this.clocks.length) this.clocks = [{ name: "UTC", offset: 0 }];
    this.selected = Math.floor(
      bounded(saved.selected, 0, this.clocks.length - 1),
    );
  }
  tick(now: number): void {
    this.now = now;
    if (flag(this.settings, "auto_rotate") && now - this.changedAt >= 10000) {
      this.selected = cycle(this.selected, 1, this.clocks.length);
      this.changedAt = now;
    }
  }
  key(key: string, delta: number, now: number): boolean {
    if (key === "wheel" || key === "ok") {
      this.selected = cycle(
        this.selected,
        key === "ok" ? 1 : delta,
        this.clocks.length,
      );
      this.changedAt = now;
    }
    return false;
  }
  save(): Settings {
    return { selected: this.selected };
  }
  view(now: number): View {
    const c = this.clocks[this.selected];
    const d = new Date(now + c.offset * MINUTE);
    return {
      title: c.name,
      value:
        pad(d.getUTCHours()) +
        ":" +
        pad(d.getUTCMinutes()) +
        (flag(this.settings, "show_seconds")
          ? ":" + pad(d.getUTCSeconds())
          : ""),
      rows: [
        localDay(now, c.offset),
        "UTC " + (c.offset >= 0 ? "+" : "") + (c.offset / 60).toFixed(2),
      ],
      hint: "Wheel / OK next clock",
    };
  }
}
