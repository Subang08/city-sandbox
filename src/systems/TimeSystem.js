import { clamp, formatClock } from '../lib/mathx.js';

/**
 * TimeSystem - virtual world clock.
 * Contract: 1 real second == 1 game minute at 1.0x. Supports pause and 0.5x..20x.
 * Time is the single source of truth that drives construction, lighting and work shifts.
 */
export class TimeSystem {
  constructor({ bus, config }) {
    this.bus = bus;
    const timeConfig = config.time || {};
    this.minutesPerSecond = timeConfig.minutesPerSecond || 1;
    this.speedPresets = timeConfig.speedPresets || [0.5, 1, 2, 5, 10, 20];
    this.speed = 1;
    this.paused = false;
    this.day = timeConfig.startDay || 1;
    this.minuteOfDay = timeConfig.startMinute || 480;
    this.totalMinutes = (this.day - 1) * 1440 + this.minuteOfDay;
    this.timeline = config.construction?.timeline || { from: 1, to: 16 };
    this.startedAt = 0;
    this.elapsedRealSeconds = 0;
    this._lastBoundary = Math.floor(this.minuteOfDay / 15);
    this._lastDay = Math.floor(this.day);
    this._emitTimer = 0;
  }

  get clock() {
    return formatClock(this.minuteOfDay);
  }

  get absoluteMinutes() {
    return this.totalMinutes;
  }

  get dayIndex() {
    return Math.floor(this.day);
  }

  /** Sun elevation driver: 0 at midnight, 1 at noon. */
  get dayFraction() {
    return this.minuteOfDay / 1440;
  }

  get isWorkHours() {
    return this.minuteOfDay > 6 * 60 && this.minuteOfDay < 19 * 60;
  }

  get formatted() {
    return `Day ${String(Math.floor(this.day)).padStart(2, '0')} · ${this.clock}`;
  }

  setSpeed(speed) {
    this.speed = clamp(speed, 0.5, 20);
    this.bus.emit('time:speed', { speed: this.speed });
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    this.bus.emit('time:paused', { paused: this.paused });
  }

  togglePause() {
    this.setPaused(!this.paused);
  }

  /** Jump to an absolute day (float) keeping the time of day. */
  setDay(day) {
    const clamped = clamp(day, this.timeline.from, this.timeline.to);
    this.day = clamped;
    this.totalMinutes = (this.day - 1) * 1440 + this.minuteOfDay;
    this.bus.emit('time:day', { day: this.day });
  }

  setMinuteOfDay(minute) {
    this.minuteOfDay = ((minute % 1440) + 1440) % 1440;
    this.totalMinutes = (this.day - 1) * 1440 + this.minuteOfDay;
    this.bus.emit('time:clock', { minuteOfDay: this.minuteOfDay, clock: this.clock });
  }

  update(dt) {
    this.elapsedRealSeconds += dt;
    if (this.paused) return;
    const gameMinutes = dt * this.minutesPerSecond * this.speed;
    this.totalMinutes += gameMinutes;
    const previousDay = Math.floor(this.day);
    this.day = 1 + this.totalMinutes / 1440;
    if (this.day > this.timeline.to + 0.999) {
      this.day = this.timeline.to + 0.999;
      this.totalMinutes = (this.day - 1) * 1440;
    }
    this.minuteOfDay = ((this.totalMinutes % 1440) + 1440) % 1440;

    const boundary = Math.floor(this.minuteOfDay / 15);
    if (boundary !== this._lastBoundary) {
      this._lastBoundary = boundary;
      this.bus.emit('time:quarter', { minuteOfDay: this.minuteOfDay });
    }
    const dayIndex = Math.floor(this.day);
    if (dayIndex !== previousDay) {
      this.bus.emit('time:newDay', { day: dayIndex });
    }
    this._emitTimer += dt;
    if (this._emitTimer > 0.2) {
      this._emitTimer = 0;
      this.bus.emit('time:tick', {
        day: this.day,
        minuteOfDay: this.minuteOfDay,
        clock: this.clock,
        speed: this.speed,
        paused: this.paused,
      });
    }
  }
}
