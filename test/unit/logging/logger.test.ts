import { describe, expect, it } from 'vitest';
import { Logger } from '../../../src/logging/logger.js';

describe('Logger', () => {
  it('writes plain lines by default with level and command prefix', () => {
    const lines: string[] = [];
    const logger = new Logger({ sink: (line) => lines.push(line) }).child('propose');
    logger.info('starting run', { mr: 42 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[propose] INFO');
    expect(lines[0]).toContain('starting run');
    expect(lines[0]).toContain('"mr":42');
  });

  it('emits JSON lines when json mode is enabled', () => {
    const lines: string[] = [];
    const logger = new Logger({ json: true, sink: (line) => lines.push(line) }).child('publish');
    logger.error('failed', { path: '/A/B' });
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.level).toBe('error');
    expect(parsed.command).toBe('publish');
    expect(parsed.message).toBe('failed');
    expect(parsed.path).toBe('/A/B');
  });

  it('suppresses messages below the configured level', () => {
    const lines: string[] = [];
    const logger = new Logger({ level: 'warn', sink: (line) => lines.push(line) });
    logger.info('should be dropped');
    logger.warn('should appear');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('should appear');
  });
});
